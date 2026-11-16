import base64
import json
import sys
import io
import subprocess
import queue
import threading
import zipfile
import xml.etree.ElementTree as ET
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio
import animation
from animation import AnimationRequest, build_html, build_scene, build_poster
from photo_dots import L


class AnimationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(studio.app, base_url="http://127.0.0.1:8765")
        self.options = {"map": "##.\n.##\n", "columns": 3, "duration": 2, "size": 512}

    def test_scene_fits_the_still_lattice(self):
        options = AnimationRequest(**self.options)
        scene = build_scene(options)
        scale, figure = scene["figure"]["scale"], scene["figure"]
        p, q = L["px"] * scale, L["py"] * scale
        actual_x = figure["cx"] - figure["centerCol"] * p + p
        actual_y = (512 - 2*q)/2 + figure["dy"] + 0.6*q
        self.assertAlmostEqual(actual_x, (512 - 3*p)/2 + 0.5*p)
        self.assertAlmostEqual(actual_y, (512 - 2*q - L["dim_dy"]*scale)/2 + 0.5*q)
        self.assertEqual(scene["loop"],2)
        self.assertEqual(scene["size"],[512,512])

    def test_reject_unsafe_or_excessive_scenes(self):
        for extra in ({"map":"</script>"}, {"columns":1}, {"map":"#\n"*101}, {"duration":99},
                      {"region":[0.7,0.1,0.2,0.8]}, {"density":float("nan")},
                      {"bg":"url(secret)"}, {"size":2048}, {"map":"   "}, {"layers":[]}):
            with self.subTest(extra=extra):
                with self.assertRaises(ValidationError):
                    AnimationRequest(**{**self.options,**extra})

    def test_brush_mask_validation_and_export(self):
        for mask in ("1", "x" * 4096, "1" * 4097):
            with self.assertRaises(ValidationError):
                AnimationRequest(**self.options, mask=mask)
        bits = "10" * 2048
        scene = build_scene(AnimationRequest(**self.options, mask=bits))
        self.assertEqual(scene["layers"][1]["region"], [0, 2, 0, 1])
        self.assertEqual(scene["layers"][1]["mask"], {"bits": bits, "columns": 3, "rows": 2})
        response = self.client.post("/api/animation/html", json={**self.options, "mask": bits})
        self.assertEqual(response.status_code, 200)
        self.assertIn(bits, response.text)

    def test_custom_dust_color_is_validated_and_exported(self):
        scene = build_scene(AnimationRequest(**self.options, dust="#00ff00"))
        self.assertEqual(scene["layers"][1]["color"], "#00ff00")
        self.assertEqual(scene["layers"][1]["red"], 0)
        default = build_scene(AnimationRequest(**self.options))
        self.assertNotIn("color", default["layers"][1])
        self.assertEqual(default["layers"][1]["red"], 0.035)
        for color in ("red", "</script>", "#12345"):
            self.assertEqual(self.client.post("/api/animation/scene", json={**self.options, "dust": color}).status_code, 422)
        exported = self.client.post("/api/animation/html", json={**self.options, "dust": "#00ff00"})
        self.assertIn('"color":"#00ff00"', exported.text)

    def test_scene_and_html_endpoints(self):
        response=self.client.post("/api/animation/scene",json=self.options)
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.json()["layers"][1]["type"],"dust")
        html=self.client.post("/api/animation/html",json=self.options)
        self.assertEqual(html.status_code,200)
        self.assertIn("attachment",html.headers["content-disposition"])
        self.assertIn("window.createDotScene",html.text)
        self.assertIn("prefers-reduced-motion",html.text)
        self.assertIn("Copyright (c) 2026 Sherif (0xSero)",html.text)
        self.assertEqual(self.client.get("/engine.js").status_code,200)
        self.assertEqual(self.client.post("/api/animation/scene",content=b"x"*65537).status_code,413)

    def test_website_kit_has_fallback_embed_and_no_source_photo(self):
        response = self.client.post("/api/animation/website", json={**self.options, "autoplay": False})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["content-type"], "application/zip")
        with zipfile.ZipFile(io.BytesIO(response.content)) as kit:
            self.assertEqual(set(kit.namelist()), {"animation.html", "poster.svg", "embed.html", "README.txt", "LICENSE"})
            html = kit.read("animation.html").decode()
            self.assertIn("let playing=false&&!reduced.matches", html)
            self.assertIn('sandbox="allow-scripts"', kit.read("embed.html").decode())
            svg = ET.fromstring(kit.read("poster.svg"))
            self.assertEqual(len(svg.findall("{http://www.w3.org/2000/svg}circle")), 6)
            self.assertNotIn("source", kit.namelist())
        self.assertEqual(self.client.post("/api/animation/website", json={**self.options, "autoplay": "yes"}).status_code, 422)

    def test_standalone_playback_controls_and_motion_preferences(self):
        scene = build_scene(AnimationRequest(**self.options))
        self.assertIn('aria-label="Dot portrait"', build_poster(scene))
        for autoplay in (True, False):
            result = subprocess.run(["node", str(Path(__file__).with_name("export-runtime.cjs")), str(autoplay).lower()],
                                    input=build_html(scene, autoplay), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_video_progress_errors_and_lock_release(self):
        def success(options,events,cancelled):
            events.put({"type":"progress","progress":0.5})
            events.put({"type":"complete","data":base64.b64encode(b"video").decode()})
        with patch.object(studio,"render_video",success):
            response=self.client.post("/api/animation/video",json=self.options)
            events=[json.loads(line) for line in response.text.splitlines()]
            self.assertEqual([e["type"] for e in events],["progress","complete"])
            self.assertFalse(studio.video_lock.locked())

        studio.video_lock.acquire()
        try:
            self.assertEqual(self.client.post("/api/animation/video",json=self.options).status_code,409)
        finally:
            studio.video_lock.release()
        def failure(options,events,cancelled):
            events.put({"type":"error","message":"encoding failed"})
        with patch.object(studio,"render_video",failure):
            response=self.client.post("/api/animation/video",json=self.options)
            self.assertEqual(json.loads(response.text)["type"],"error")
            self.assertFalse(studio.video_lock.locked())

    def test_video_sizes_capture_the_same_motion_before_resizing(self):
        for size in (512, 1024):
            with self.subTest(size=size):
                renderer = MagicMock()
                page = renderer.return_value.__enter__.return_value.chromium.launch.return_value.__enter__.return_value.new_page.return_value
                page.evaluate.return_value = base64.b64encode(b"frame").decode()
                encoder = MagicMock()
                encoder.poll.return_value = 0
                encoder.returncode = 0

                def encode(command, **kwargs):
                    Path(command[-1]).write_bytes(b"video")
                    return encoder

                events = queue.Queue()
                with patch.object(animation, "sync_playwright", renderer), patch.object(animation.subprocess, "Popen", side_effect=encode) as process, patch.object(animation, "build_scene", wraps=build_scene) as scene:
                    animation.render_video(AnimationRequest(**{**self.options, "size": size}), events, threading.Event())
                self.assertEqual(scene.call_args.args[0].size, 1024)
                browser = renderer.return_value.__enter__.return_value.chromium.launch.return_value.__enter__.return_value
                browser.new_page.assert_called_once_with(viewport={"width": 1024, "height": 1024}, device_scale_factor=1)
                command = process.call_args.args[0]
                self.assertEqual(command[command.index("-vf") + 1], f"scale={size}:{size}:flags=lanczos")
                self.assertEqual(list(events.queue)[-1]["type"], "complete")



if __name__ == "__main__":
    unittest.main()
