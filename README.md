# ascii-art

Turn any photo, sculpture, object or drawing into a figure made of dots on a fixed
grid — charcoal ground, two grey tones, rare crimson — then animate it into a
seamless loop: disintegration into wind-blown dust, things emerging or growing out
of the figure, voids, tentacles, fine-stipple creatures.

This repo is the skill: the method, the engine, and the scripts that do the
mechanical parts.

```
source image ──photo_dots/mask──► dot map (text) ──render_map──► still
                                        │
                                   scene JSON ──build_scene──► self-contained HTML (render(tt))
                                                          └──grab_frames──► PNG frames ──ffmpeg──► MP4
```

## Browser portrait and animation editor

Start the local editor using the pinned Nix environment:

```bash
cd ~/Projects/ascii-art
nix develop "path:$PWD/nix" -c python scripts/studio.py
```

Open [http://127.0.0.1:8765](http://127.0.0.1:8765). Keep the terminal running;
press Ctrl+C to stop the server. With direnv active, `python scripts/studio.py`
is sufficient.

The toolbar save status distinguishes **Demo ready**, **Unsaved changes**, **Saving…**,
**Saved in this browser**, and **Project exported**. Changes remain unprotected
until their browser-recovery write finishes or that exact snapshot is exported
as a project. Later edits become unsaved again; an older save cannot clear their
warning. PNG, SVG, video, website kits, and settings-only exports do not protect
the editable project. Click the save status to see its explanation and open
optional recovery controls. The adjacent **Save project** button exports the
editable project. **Settings** opens a menu for loading or downloading controls
without a photo. Menus close with Escape or a click outside them.
A project export starts a browser download;
confirm that it completed and keep the `.dotstudio` file. The page cannot detect
a cancelled or blocked download.

While editable changes are unprotected, closing, refreshing, or navigating away
requests the browser's standard leave warning. The untouched demo and saved work
do not request it. Switching preview/workspace views alone does not count as an
artwork change. Browsers control the warning wording and whether to display it,
and phone browsers may close a tab or app without an event. Keep a saved project
or wait for browser recovery to finish rather than relying on that warning.

Choose or drop a JPEG, PNG, or WebP photo (up to 12 MB and 24 megapixels).
Use **Source** to drag the photo into position, or use the zoom and position
sliders with a keyboard. **Compare** provides a movable source/artwork split.
The **Circular PFP guide** previews a platform's circular crop; it is not part
of exports. Use **Artwork** to tune detail, coverage, softness, and local contrast.
Invert source tones when a dark subject sits against a light background, then
adjust **Remove dark tones** and **Transition softness** to suppress the ground.
These controls use brightness, not automatic subject recognition, and may also
remove dark details from the subject.
Choose a palette or custom colors, adjust dot weight, and check the small
circular avatar previews before downloading PNG or SVG. Exports always contain
the artwork, even while the source or comparison preview is selected. During
conversion the last finished artwork remains visible, downloads wait for the
latest result, and intermediate requests are coalesced.

Check **Transparent background (PNG)** to export just the dots over transparency;
the editor keeps showing your chosen ground color. This option affects PNG only,
so SVG and animated exports retain their ground. Both PNG transparency and web
autoplay preferences are saved in settings and projects.

**Save settings** downloads a versioned JSON file with the controls, crop,
colors, guide preference, animation controls, and export dimensions. It does not contain the photo.
Load settings onto an already-selected photo, or load them first and reselect
the original photo to resume with the saved crop. Invalid files are rejected
before any controls change. Undo/redo supports 60 snapshots with buttons,
Ctrl/Command+Z, and Ctrl/Command+Shift+Z (or Ctrl+Y). Selecting a new photo starts
a new undo history; settings files do not save history.

**Save project** downloads a `.dotstudio` file containing your original photo,
the exact finished dot map, all portrait and animation settings, painted dust
selection, and active workspace. **Open project** restores them after a refresh
without reselecting the photo. Projects also work with the included demo and no
source photo. Files are validated before replacing the current work; opening a
project starts a fresh undo history. Save only becomes available when conversion
is finished. Project files are limited to 18 MB, including a source image up to
12 MB and 24 megapixels. They include the original image bytes and any image
metadata, so store them privately; `.dotstudio` files are ignored by Git.
Settings-only JSON remains available when you want controls without a photo.

**Session recovery** is optional and off by default. Enable **Remember this session
in this browser** under the photo controls to keep one local recovery copy in
IndexedDB. It includes the original image and metadata, dot map, settings, and
active workspace. Wait for **Session saved** before refreshing; writes happen
after conversion finishes and a short idle period. On reopening the editor,
choose **Restore saved session** in the banner to load it. Current work is never
replaced automatically. Unchecking recovery or using **Clear stored session**
removes the stored copy and leaves your open artwork alone. Storage failures are
reported; a downloaded project is still the portable backup. Storage belongs to
this browser profile and exact site address/port; other people using the same
profile may restore it, and clearing browser data removes it. Only the latest
saved session is kept. One tab at a time can enable, restore, or clear recovery;
other tabs must download a project or wait until the owning tab closes or turns
recovery off. This protection requires browser Web Locks support. If unavailable,
recovery stays off and project downloads remain available.

### Animation workspace

Choose **Animate** in the top toolbar after creating your portrait, or try the
included demo. The current map, colors, and dot weight carry over from Portrait.
Choose a 2–12 second loop, wind direction and strength, and dust amount. Click
**Draw dust area** and drag a rectangle on the paused preview, or use the four
region sliders. **Use the whole figure** selects the full map. The region outline
and circular PFP guide are editor aids and never appear in exports.

Choose **Brush** or **Erase** in the selection tool menu to refine the area.
Adjust brush radius and paint on the paused preview; blue shading shows selected
areas. **Clear dust selection** starts an empty selection. Each stroke supports
Undo/Redo. For keyboard use, Tab into the selection canvas, move with arrow keys
(Shift moves faster), press Space to paint or erase, and Escape to finish.
Drawing a new rectangle or moving a rectangle slider replaces the painted area.
The selection uses a normalized 64 × 64 grid and carries through detail changes,
HTML, and MP4 exports. Selecting a new photo clears the painted mask unless you
loaded settings first; opening a project restores its saved mask.

Use **Reverse wind** to turn the direction by 180 degrees. **Use custom dust
color** applies the color picker to all moving particles, including exported
HTML and MP4; choosing a color enables it. Turn it off to return to portrait
tones and rare crimson streaks. The figure itself keeps its original colors.

Use **Play/Pause**, **Restart**, and the timeline to inspect the seamless loop.
**Gentle drift**, **Strong wind**, and **Slow dissolve** presets set duration,
wind, and dust amount while keeping your portrait and painted selection. Undo
restores the previous controls. These are starting points using the same dust
effect; you can adjust any slider afterwards.
Enable **Compare still / motion** to reveal the original, complete portrait on
the left and the animation on the right. Move its split slider while playing or
paused. Selecting a dust area exits comparison so the full canvas can be painted.
The split, labels, and selection overlays never enter exports.
Editing motion controls pauses playback while rebuilding the preview. Switching
back to Portrait preserves your settings; still PNG/SVG exports remain available
there. Version-5 settings files save both workspaces, the painted mask, export
preferences, and dust color. Version-1 through version-4 settings still load with
defaults for missing controls. Existing project files remain compatible; recovery
consent is a browser choice and is not included in settings or projects.

**Download HTML** creates a self-contained 1024-pixel animation with play/pause
and reduced-motion support. It contains the dot map, palette, engine, and MIT
license notice, and needs no server to play. **Render MP4** produces a silent
H.264 video at 24 fps in 512 × 512 or 1024 × 1024. Both sizes capture the same
1024-pixel motion as the preview; smaller videos are resized after capture.
The progress display reports
rendering and encoding; Cancel stops the job and releases its temporary files.
Only one MP4 renders at a time. Exports capture the settings at the moment you
start rendering; later edits apply to your next export. Very complex renders
have a time limit: lower detail, dust amount, dimensions, or duration if needed.

**Download website kit ZIP** packages `animation.html`, `poster.svg`, `embed.html`,
`README.txt`, and the engine's MIT `LICENSE`. Extract it, upload the files together
to your website, then copy the responsive iframe example from `embed.html`,
adjusting paths to that folder. The editor does not publish anything. Use
`poster.svg` for a permanent still image. The HTML and kit honor **Autoplay on the
web**; reduced-motion preferences start with the still poster. Visitors can
explicitly start or pause motion, and hidden tabs pause. Without JavaScript or
canvas support, the embedded poster remains visible. The kit excludes the source
photo and project file; its finished artwork can still identify the subject.
Custom website Content Security Policies may require configuration for the
animation's inline scripts and data-URL poster; instructions are included.

The mobile layout keeps the artwork first, stacks source and export controls
below it, and provides larger controls on narrow screens and touch pointers.
Painting captures the primary pointer and ignores other fingers until that
stroke ends or is cancelled. Automated pointer tests cover this behavior;
physical phone/tablet testing is still needed for device-specific scrolling and
gesture feel. Exported playback is covered by offline JavaScript runtime tests;
automated navigation to downloaded `file://` HTML is restricted by the browser tool.

On narrow screens, **Choose photo** and **Adjust controls** sit beside the preview.
The bottom **Preview / Adjust / Export** bar jumps to the active workspace's
controls without changing the artwork. Under **Translate**, open **What do these
controls do?** for short explanations and starting examples for detail, coverage,
softness, local contrast, and background removal.

**Preview PNG export** opens the exact selected export dimensions. Transparency
is displayed over a checkerboard, which is not included in the downloaded image.
Choose **View at actual pixels** to inspect one image pixel per CSS pixel, scrolling
for large images, or leave it off to fit the dialog. **Download this PNG** downloads
that previewed frame. The main PNG download still works without opening a preview.

The server listens only on `127.0.0.1`. Original photos are processed in memory
and not saved or sent to an external service. Video rendering uses a private
temporary local HTML file and MP4, removed after completion, cancellation, or error.
Refreshing the page clears the selected photo and settings, so save a project
before leaving to resume later, or save settings and reselect the original photo.
The original CLI commands still work.

For development, edit `web/` for the interface and `scripts/studio.py` for the
local API. `web/model.mjs` contains settings validation, history, and crop math.
`web/animation-ui.mjs` controls animation playback and export, while
`scripts/animation.py` validates scenes and renders video. `assets/engine.js`
exposes independent `createDotScene` renderers and retains the CLI's `render(t)` API.
Both the API and CLI use `photo_to_map` in `scripts/photo_dots.py`.
Reload the page after frontend edits and restart the server after Python edits.
Run the focused API tests inside the Nix environment:

```bash
python -m unittest discover -s tests -v
node --test tests/*.test.mjs
```

## Requirements

- Python 3.10+ with `numpy`, `scipy`, `Pillow`, `scikit-image`
- `playwright` with a chromium build (`python -m playwright install chromium`)
- `ffmpeg` for encoding

```
pip install numpy scipy pillow scikit-image playwright
python -m playwright install chromium
```

## Quickstart

### Local Nix setup (Omarchy)

The pinned environment in `nix/` supplies Python and its libraries, FFmpeg, and
Playwright's matching Chromium headless browser. No pip installation or
`playwright install` is needed. It targets this machine's `x86_64-linux` platform.

```bash
cd ~/Projects/ascii-art
direnv allow
mkdir -p work
python scripts/build_scene.py examples/scenes/bust-dust.scene.json work/demo.html
xdg-open work/demo.html
```

Direnv activates the environment at the next terminal prompt. Alternatively,
start it explicitly with `nix develop "path:$PWD/nix"`. Using a path flake scoped
to `nix/` works before committing and avoids copying photos or outputs into the
Nix store. Approve `.envrc` only after reviewing it. This environment does not
sandbox scripts' access to your files.

Generate a still from your own photo (a bright subject on a dark background):

```bash
python scripts/photo_dots.py "/absolute/path/to/photo.jpg" work/map.txt 52 58 86
python scripts/render_map.py work/map.txt work/still 0.6
```

Export the included eight-second animation as MP4. Use a fresh frame directory
for each capture so older frames cannot extend the encoded video:

```bash
python scripts/grab_frames.py work/demo.html work/demo-frames 30 8
ffmpeg -framerate 30 -i work/demo-frames/f%04d.png -frames:v 240 \
  -c:v libx264 -crf 16 -pix_fmt yuv420p -movflags +faststart work/demo.mp4
```

Review dependency changes before updating the environment with
`nix flake update --flake "path:$PWD/nix"`. Photos and generated files can stay
in the already-ignored `work/` directory. The other example scenes reference
photographs that are not bundled; `bust-dust` needs only the included map.

### Upstream commands

```sh
# 1. image -> dot map.  rows, then the bright/mid percentiles of the subject's own tones
python scripts/photo_dots.py photo.jpg map.txt 52 58 86

# 2. look at the still before anything moves
python scripts/render_map.py map.txt still 0.6

# 3. scene JSON -> animated page
python scripts/build_scene.py examples/scenes/bust-dust.scene.json out.html

# 4. frames, then encode
python scripts/grab_frames.py out.html frames 30 12      # fps, seconds
ffmpeg -framerate 30 -i frames/f%04d.png -c:v libx264 -crf 16 -pix_fmt yuv420p \
       -movflags +faststart piece.mp4
```

`grab_frames.py out.html sheet.png sheet` captures a contact sheet instead of frames.

## The look

| Element | Rule |
|---|---|
| Ground | flat `#161616`, never pure black |
| Lattice | one fixed grid, tall cells (≈19 × 36 px), every still dot on a cell centre |
| Two tones | bright `#f2f2f0` (r ≈ 6.5) and dim `#70706e` (r ≈ 2.85), nudged 7 px down |
| Accent | crimson `#dc143c`, rare, only on things that move |
| Grain | subject = coarse lattice; visitors, voids, far dust = fine stipple |

Coverage matters more than contrast: most subject cells should be **bright**; dim
dots are shadow accents, empty cells are line art (eyes, mouth, the deepest folds).

## Tools

| Script | Purpose |
|---|---|
| `scripts/photo_dots.py IMG OUT ROWS [top% mid%]` | image → dot map (env `BLUR`, `MIX`, `ISO`) |
| `scripts/render_map.py MAP OUT [scale]` | map → PNG + SVG |
| `scripts/rotate_map.py MAP DEG SCALE OUT` | tilt or scale a map on the same grid |
| `scripts/build_scene.py SCENE.json OUT.html` | scene → animated page (`assets/engine.js`) |
| `scripts/grab_frames.py HTML OUT\|DIR ...` | contact sheet or all frames, headless |

## Docs

- `SKILL.md` — the craft: anatomy, step-by-step method, motion vocabulary, loop maths, review checklist.
- `references/engine.md` — scene JSON format, layers and their parameters.
- `references/case-study.md` — one piece end to end, including every round of feedback.

## Examples

`examples/scenes/*.json` and `examples/bust-skull.map.txt` are the scenes and dot
map of one finished piece. The reference photographs they point at are **not**
included (third-party imagery), so the scenes document structure rather than run
as-is; `bust-skull.map.txt` is enough to build the figure layers.

## License

MIT — see `LICENSE`. It covers this code and text only. Any image you feed the
scripts stays yours (or its owner's); nothing here grants rights to it.
