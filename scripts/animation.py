"""Validated dust scenes and local video rendering for Dot Studio."""

import base64
import json
import io
import zipfile
import math
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from playwright.sync_api import sync_playwright

from photo_dots import L

ENGINE = Path(__file__).resolve().parent.parent / "assets/engine.js"
LICENSE = ENGINE.parent.parent / "LICENSE"
FPS = 24


class AnimationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    map: str = Field(min_length=1, max_length=20100, pattern=r"^[#. @rq\n]+$")
    columns: int = Field(ge=1, le=200)
    size: Literal[512, 1024] = 1024
    duration: int = Field(default=8, ge=2, le=12)
    autoplay: bool = Field(default=True, strict=True)
    angle: float = Field(default=-160, ge=-180, le=180)
    strength: float = Field(default=1, ge=0.25, le=3)
    density: float = Field(default=0.65, ge=0, le=1)
    region: tuple[float, float, float, float] = (0, 0.1, 0.6, 0.9)
    mask: str = Field(default="", max_length=4096, pattern=r"^(?:[01]{4096})?$")
    radius: float = Field(default=1, ge=0.5, le=1.6)
    bg: str = Field(default="#161616", pattern=r"^#[0-9a-fA-F]{6}$")
    ink: str = Field(default="#f2f2f0", pattern=r"^#[0-9a-fA-F]{6}$")
    shadow: str = Field(default="#70706e", pattern=r"^#[0-9a-fA-F]{6}$")
    dust: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")

    @model_validator(mode="after")
    def bounded_scene(self):
        rows = self.map.removesuffix("\n").split("\n")
        if len(rows) > 100 or any(len(row) > self.columns for row in rows):
            raise ValueError("Portrait dimensions exceed the animation limits.")
        if not any(c in self.map for c in "#.@rq"):
            raise ValueError("The portrait has no dots to animate.")
        x0, y0, x1, y1 = self.region
        if not all(math.isfinite(v) and 0 <= v <= 1 for v in self.region) or x0 >= x1 or y0 >= y1:
            raise ValueError("Choose a non-empty dust region inside the portrait.")
        return self


def build_scene(options):
    rows = len(options.map.removesuffix("\n").split("\n"))
    scale = options.size * 0.9 / max(options.columns * L["px"], rows * L["py"] + L["dim_dy"])
    p, q = L["px"] * scale, L["py"] * scale
    ox = (options.size - options.columns * p) / 2
    x0, y0, x1, y1 = options.region
    region = [min(options.columns - 1, math.floor(x0 * options.columns)),
              min(options.columns - 1, math.ceil(x1 * options.columns) - 1),
              min(rows - 1, math.floor(y0 * rows)), min(rows - 1, math.ceil(y1 * rows) - 1)]
    if options.mask:
        region = [0, options.columns - 1, 0, rows - 1]
    angle = math.radians(options.angle)
    return {
        "title": "Dot Studio — Dust portrait", "size": [options.size, options.size],
        "loop": options.duration, "seed": 11,
        "colors": {"bg": options.bg, "bright": options.ink, "highlight": options.ink,
                   "dim": options.shadow, "red": "#dc143c"},
        "figure": {"map": options.map.removesuffix("\n"), "scale": scale,
                   "cx": ox + (options.columns / 2 - 0.5) * p,
                   "centerCol": options.columns / 2, "dy": -L["dim_dy"] * scale / 2 - 0.1 * q},
        "lattice": {**L, "r_big": L["r_big"] * options.radius, "r_dim": L["r_dim"] * options.radius},
        "wind": {"dir": [math.cos(angle) * options.strength, math.sin(angle) * options.strength], "turb": 0.9},
        "layers": [{"type": "figure", "shimmer": 0, "lightBand": False},
                   {"type": "dust", "region": region, "density": options.density, "red": 0 if options.dust else 0.035,
                    **({"color": options.dust} if options.dust else {}),
                    **({"mask": {"bits": options.mask, "columns": options.columns, "rows": rows}} if options.mask else {})}],
    }


def build_poster(scene):
    width, height = scene["size"]
    figure, lattice = scene["figure"], scene["lattice"]
    rows = figure["map"].split("\n")
    scale = figure["scale"]
    p, q = lattice["px"] * scale, lattice["py"] * scale
    ox = figure["cx"] - figure["centerCol"] * p
    oy = (height - len(rows) * q) / 2 + figure["dy"]
    circles = []
    for y, row in enumerate(rows):
        for x, char in enumerate(row):
            if char not in "#.@rq":
                continue
            dim = char in ".q"
            radius = lattice["r_dim" if dim else "r_big"] * scale
            color = scene["colors"]["dim" if dim else "bright"]
            cy = oy + (y + 0.6) * q + (lattice["dim_dy"] * scale if dim else 0)
            circles.append(f'<circle cx="{ox + (x + 1) * p:.3f}" cy="{cy:.3f}" r="{radius:.3f}" fill="{color}"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="Dot portrait">'
            f'<rect width="100%" height="100%" fill="{scene["colors"]["bg"]}"/>' + "".join(circles) + '</svg>')


def build_html(scene, autoplay=True):
    data = json.dumps(scene, separators=(",", ":")).replace("<", "\\u003c")
    poster = base64.b64encode(build_poster(scene).encode()).decode()
    # Preview, downloadable HTML, and video all run the same engine.
    return f'''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dot Studio — Dust portrait</title>
<style>body{{margin:0;background:{scene['colors']['bg']};display:grid;place-items:center;min-height:100vh}}
canvas,img{{width:min(100vw,100vh);height:auto;display:block}}[hidden]{{display:none!important}}
button{{position:fixed;bottom:12px;right:12px;min-height:44px;padding:9px 16px;border:1px solid #888;border-radius:4px;background:#161616;color:#fff}}
button:focus-visible{{outline:3px solid #79c8ed;outline-offset:3px}}</style>
<img id="poster" src="data:image/svg+xml;base64,{poster}" alt="Dot portrait">
<canvas id="c" aria-label="Animated dot portrait" hidden></canvas><button id="play" hidden>Play animation</button>
<script>window.SCENE={data};window.MANUAL=true;</script>
<script>/*\n{LICENSE.read_text()}\n*/\n{ENGINE.read_text()}</script>
<script>
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let playing={str(autoplay).lower()}&&!reduced.matches;
let elapsed=0,previous=performance.now();const button=document.getElementById('play');
const canvas=document.getElementById('c'),poster=document.getElementById('poster');
function label(){{button.textContent=playing?'Pause animation':'Play animation';button.setAttribute('aria-pressed',String(playing));}}
function showMotion(){{canvas.hidden=false;poster.hidden=true;}}
render(0);if(playing)showMotion();button.hidden=false;label();
button.onclick=()=>{{playing=!playing;previous=performance.now();if(playing)showMotion();label();}};
reduced.addEventListener('change',()=>{{if(reduced.matches){{playing=false;canvas.hidden=true;poster.hidden=false;label();}}}});
document.addEventListener('visibilitychange',()=>{{if(document.hidden){{playing=false;label();}}}});
function tick(now){{if(playing){{elapsed=(elapsed+(now-previous)/1000)%window.LOOP;render(elapsed);}}previous=now;requestAnimationFrame(tick);}}
if(!window.CAPTURE)requestAnimationFrame(tick);
</script></html>'''


def build_web_kit(options):
    scene = build_scene(options)
    embed = '''<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Dot portrait embed example</title>
<!-- Copy this figure into your page; adjust paths if files live in another directory. -->
<figure style="width:100%;max-width:512px;margin:0">
<iframe src="animation.html" title="Animated dot portrait" loading="lazy" sandbox="allow-scripts"
  width="512" height="512" style="display:block;width:100%;height:auto;aspect-ratio:1;border:0">
  <a href="poster.svg">View the still portrait</a>
</iframe>
<figcaption><a href="poster.svg">View the still portrait</a></figcaption>
</figure></html>'''
    instructions = """Dot Studio website kit

Files: animation.html (self-contained animation), poster.svg (still fallback),
embed.html (responsive iframe example), LICENSE (original engine's MIT license).

Preview: open animation.html or embed.html in a browser. No Python or Nix is
needed by your visitors. For your website, upload these files together to a
folder you choose, and copy the figure from embed.html into your page. Adjust
the iframe src and poster link to that folder. No site is published by this ZIP.

The Play/Pause button always works. Your chosen autoplay preference is embedded;
reduced-motion preferences start with the still poster instead. Without JavaScript
or canvas support, the poster stays visible. Hidden tabs pause playback.

For an always-still placement, use:
<img src="poster.svg" alt="Dot portrait" width="512" height="512"
     style="max-width:100%;height:auto">

The animation contains inline JavaScript and a data-URL poster. If your server
applies a Content Security Policy to animation.html, it must permit those assets.
Keep the iframe sandbox="allow-scripts" attribute. The kit contains the dot artwork,
not your original photo or project file; the artwork can still identify its subject.
"""
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as kit:
        for name, content in {"animation.html": build_html(scene, options.autoplay), "poster.svg": build_poster(scene),
                              "embed.html": embed, "README.txt": instructions, "LICENSE": LICENSE.read_text()}.items():
            kit.writestr(name, content)
    return archive.getvalue()


def render_video(options, events, cancelled):
    """Emit bounded progress and one MP4; remove temporary files on every exit."""
    process = None
    try:
        # Keep wind physics identical to the 1024px preview, then resize the video.
        scene = build_scene(options.model_copy(update={"size": 1024}))
        frames = options.duration * FPS
        deadline = time.monotonic() + 180
        events.put({"type": "progress", "progress": 0, "message": "Preparing the renderer…"})
        with tempfile.TemporaryDirectory(prefix="dot-studio-") as folder, tempfile.TemporaryFile() as errors:
            directory = Path(folder)
            page_path, video_path = directory / "scene.html", directory / "portrait.mp4"
            page_path.write_text(build_html(scene))
            with sync_playwright() as playwright:
                with playwright.chromium.launch() as browser:
                    page = browser.new_page(viewport={"width": 1024, "height": 1024}, device_scale_factor=1)
                    page.add_init_script("window.CAPTURE=true; window.MANUAL=true")
                    js_errors = []
                    page.on("pageerror", lambda error: js_errors.append(str(error)))
                    page.goto(page_path.as_uri())
                    process = subprocess.Popen([
                        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-vcodec", "png",
                        "-framerate", str(FPS), "-i", "pipe:0", "-an", "-c:v", "libx264", "-crf", "20",
                        "-vf", f"scale={options.size}:{options.size}:flags=lanczos",
                        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video_path),
                    ], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=errors)
                    for frame in range(frames):
                        if cancelled.is_set():
                            return
                        if time.monotonic() > deadline:
                            raise RuntimeError("Rendering took too long. Try lower detail, less dust, or a smaller video.")
                        png = page.evaluate("t => {render(t);return document.getElementById('c').toDataURL('image/png').split(',')[1]}", frame / FPS)
                        if js_errors:
                            raise RuntimeError("The animation could not be rendered. Try resetting the motion controls.")
                        process.stdin.write(base64.b64decode(png))
                        if frame % 8 == 0:
                            events.put({"type": "progress", "progress": 0.95 * (frame + 1) / frames,
                                        "message": "Rendering your loop…"})
                    process.stdin.close()
                    events.put({"type": "progress", "progress": 0.96, "message": "Finishing the MP4…"})
                    encoding_deadline = time.monotonic() + 60
                    while process.poll() is None:
                        if cancelled.is_set():
                            return
                        if time.monotonic() > encoding_deadline:
                            raise RuntimeError("Video encoding took too long. Try a shorter or smaller loop.")
                        try:
                            process.wait(timeout=0.2)
                        except subprocess.TimeoutExpired:
                            pass
                    if process.returncode:
                        raise RuntimeError("Video encoding failed. Confirm FFmpeg is available in the Nix environment.")
            if cancelled.is_set():
                return
            if video_path.stat().st_size > 64 * 1024 * 1024:
                raise RuntimeError("The video is too large. Try a smaller size or shorter loop.")
            events.put({"type": "complete", "data": base64.b64encode(video_path.read_bytes()).decode()})
    except Exception as error:
        if not cancelled.is_set():
            events.put({"type": "error", "message": str(error) if isinstance(error, RuntimeError)
                        else "Video export failed. Check the Nix environment and try again."})
    finally:
        if process and process.poll() is None:
            process.kill()
            process.wait()
