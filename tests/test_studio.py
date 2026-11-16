import io
import sys
import unittest
import tracemalloc
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import studio


def portrait_bytes():
    image = Image.new("RGB", (160, 200), "black")
    draw = ImageDraw.Draw(image)
    draw.ellipse((35, 20, 125, 125), fill=(230, 220, 210))
    draw.rectangle((45, 110, 115, 195), fill=(140, 130, 120))
    draw.ellipse((50, 55, 65, 70), fill="black")
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(studio.app, base_url="http://127.0.0.1:8765")

    def post(self, data=None, query="", **kwargs):
        return self.client.post("/api/convert?rows=16" + query,
                                content=portrait_bytes() if data is None else data,
                                headers={"Content-Type": "application/octet-stream"}, **kwargs)

    def test_photo_and_crop(self):
        response = self.post()
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(len(result["map"].splitlines()), 16)
        self.assertEqual(result["columns"], int(16 * studio.L["py"] / studio.L["px"]))
        self.assertIn("#", result["map"])
        self.assertEqual(set(result["map"]) - set("#. \n"), set())
        self.assertNotEqual(result["map"], self.post(query="&zoom=2&x=0&y=0").json()["map"])

    def test_empty_dot_results_are_rejected(self):
        response = self.post(query="&bright=0&mid=0")
        self.assertEqual(response.status_code, 422)
        self.assertIn("dots", response.json()["detail"])
        output = io.BytesIO()
        Image.new("RGB", (64, 64), "white").save(output, format="PNG")
        response = self.post(output.getvalue(), query="&mix=0&blur=0")
        self.assertEqual(response.status_code, 422)

    def test_normal_conversion_avoids_full_size_float_rgb(self):
        image = Image.open(io.BytesIO(portrait_bytes())).resize((1000, 1000))
        studio.photo_to_map(image, 16)
        tracemalloc.start()
        try:
            text, _ = studio.photo_to_map(image, 16)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertIn("#", text)
        self.assertLess(peak, 16 * 1024 * 1024)

    def test_invalid_settings(self):
        for query in ("&zoom=0", "&bright=90&mid=10", "&mix=nan", "&x=2", "&blur=inf",
                      "&cutoff=1", "&feather=-0.1", "&cutoff=nan"):
            with self.subTest(query=query):
                self.assertEqual(self.post(query=query).status_code, 422)

    def test_upload_limits_and_invalid_images(self):
        self.assertEqual(self.post(b"not an image").status_code, 422)
        with patch.object(studio, "MAX_BYTES", 20):
            self.assertEqual(self.post().status_code, 413)
        with patch.object(studio, "MAX_PIXELS", 100):
            self.assertEqual(self.post().status_code, 422)
        image = Image.new("RGB", (40, 40), "black")
        output = io.BytesIO()
        image.save(output, format="PNG")
        result = self.post(output.getvalue())
        self.assertEqual(result.status_code, 422)
        self.assertIn("No visible subject", result.json()["detail"])
        output = io.BytesIO()
        Image.new("RGB", (1, 1), "white").save(output, format="PNG")
        self.assertEqual(self.post(output.getvalue(), query="&zoom=3").status_code, 422)

    def test_local_boundary_and_static_files(self):
        self.assertEqual(self.client.get("/", headers={"Host": "untrusted.example"}).status_code, 400)
        self.assertEqual(self.client.post("/api/convert", headers={"Origin": "https://untrusted.example"}).status_code, 403)
        self.assertEqual(self.client.post("/api/convert", json={}).status_code, 415)
        for path in ("/", "/static/studio.js", "/static/studio.css", "/api/sample"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])
        self.assertEqual(self.client.get("/static/../scripts/studio.py").status_code, 404)

    def test_transparent_photo_has_no_hidden_subject(self):
        image = Image.new("RGBA", (40, 40), (255, 255, 255, 0))
        output = io.BytesIO()
        image.save(output, format="PNG")
        self.assertEqual(self.post(output.getvalue()).status_code, 422)

    def test_background_cutoff_suppresses_a_gray_ground(self):
        image = Image.new("RGB", (160, 160), (60, 60, 60))
        draw = ImageDraw.Draw(image)
        draw.ellipse((40, 35, 120, 145), fill=(220, 210, 200))
        output = io.BytesIO()
        image.save(output, format="PNG")
        default = self.post(output.getvalue()).json()["map"]
        separated = self.post(output.getvalue(), query="&cutoff=0.4&feather=0.1").json()["map"]
        self.assertNotEqual(default, separated)
        self.assertFalse(separated.splitlines()[0].strip())
        self.assertIn("#", separated)


if __name__ == "__main__":
    unittest.main()
