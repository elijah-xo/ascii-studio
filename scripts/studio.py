"""Local portrait editor. Run with: python scripts/studio.py"""

import asyncio
import io
import json
import queue
import threading
import warnings
from math import floor
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import ValidationError
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from photo_dots import L, photo_to_map
from animation import AnimationRequest, ENGINE, build_html, build_scene, build_web_kit, render_video

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 24_000_000
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
conversion_lock = asyncio.Lock()
video_lock = threading.Lock()


@app.middleware("http")
async def local_requests(request, call_next):
    origin = request.headers.get("origin")
    if request.method == "POST" and origin and origin != str(request.base_url).rstrip("/"):
        return JSONResponse(
            {"detail": "Only requests from this local editor are allowed."}, status_code=403
        )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' blob: data:; object-src 'none'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    return response


@app.get("/")
def index():
    return FileResponse(ROOT / "web/index.html")


@app.get("/api/sample")
def sample():
    text = (ROOT / "examples/bust-skull.map.txt").read_text()
    return {"map": text, "columns": max(map(len, text.splitlines())), "lattice": L}


@app.get("/engine.js")
def engine():
    return FileResponse(ENGINE, media_type="application/javascript")


async def animation_options(request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 65536:
            raise HTTPException(413, "The animation request is too large.")
    try:
        return AnimationRequest.model_validate_json(data)
    except ValidationError as error:
        raise HTTPException(422, "Invalid animation settings: " + error.errors()[0]["msg"]) from error


@app.post("/api/animation/scene")
async def animation_scene(request: Request):
    return build_scene(await animation_options(request))


@app.post("/api/animation/html")
async def animation_html(request: Request):
    options = await animation_options(request)
    return Response(build_html(build_scene(options), options.autoplay), media_type="text/html",
                    headers={"Content-Disposition": 'attachment; filename="portrait-loop.html"'})


@app.post("/api/animation/website")
async def animation_website(request: Request):
    options = await animation_options(request)
    data = await run_in_threadpool(build_web_kit, options)
    return Response(data, media_type="application/zip",
                    headers={"Content-Disposition": 'attachment; filename="dot-website-kit.zip"'})


@app.post("/api/animation/video")
async def animation_video(request: Request):
    options = await animation_options(request)
    if not video_lock.acquire(blocking=False):
        raise HTTPException(409, "Another video is rendering. Wait for it to finish or cancel it first.")
    events, cancelled = queue.Queue(), threading.Event()

    async def stream():
        def work():
            try:
                render_video(options, events, cancelled)
            finally:
                events.put({"type": "end"})
                video_lock.release()
        task = asyncio.create_task(run_in_threadpool(work))
        try:
            while True:
                event = await run_in_threadpool(events.get)
                if event["type"] == "end":
                    break
                yield json.dumps(event) + "\n"
                if event["type"] in {"complete", "error"}:
                    break
        finally:
            cancelled.set()
            await asyncio.shield(task)
    return StreamingResponse(stream(), media_type="application/x-ndjson")


def convert(data, rows, bright, mid, blur, mix, zoom, x, y, invert, cutoff, feather):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Choose a JPEG, PNG, or WebP image.")
                if source.width * source.height > MAX_PIXELS:
                    raise ValueError("Choose an image smaller than 24 megapixels.")
                image = ImageOps.exif_transpose(source)
                # Flatten transparency against black, matching the converter's dark ground.
                rgba = image.convert("RGBA")
                image = Image.new("RGB", rgba.size, "black")
                image.paste(rgba, mask=rgba.getchannel("A"))
                side = min(image.size) / zoom
                if side < 1:
                    raise ValueError("This photo is too small for the selected zoom.")
                left, top = (image.width - side) * x, (image.height - side) * y
                image = image.crop(tuple(floor(v + 0.5) for v in (left, top, left + side, top + side)))
                if invert:
                    image = ImageOps.invert(image)
                text, columns = photo_to_map(image, rows, bright, mid, blur, mix,
                                             cutoff=cutoff, feather=feather)
                return {"map": text, "columns": columns, "lattice": L}
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as error:
        raise HTTPException(422, str(error) if not isinstance(error, UnidentifiedImageError)
                            else "This file is not a readable image.") from error


@app.post("/api/convert")
async def convert_photo(
    request: Request,
    rows: int = Query(48, ge=16, le=80),
    bright: float = Query(58, ge=0, le=100, allow_inf_nan=False),
    mid: float = Query(86, ge=0, le=100, allow_inf_nan=False),
    blur: float = Query(4, ge=0, le=10, allow_inf_nan=False),
    mix: float = Query(0.7, ge=0, le=1.2, allow_inf_nan=False),
    zoom: float = Query(1, ge=1, le=3, allow_inf_nan=False),
    x: float = Query(0.5, ge=0, le=1, allow_inf_nan=False),
    y: float = Query(0.5, ge=0, le=1, allow_inf_nan=False),
    invert: bool = False,
    cutoff: float = Query(0.12, ge=0, le=0.9, allow_inf_nan=False),
    feather: float = Query(0, ge=0, le=0.3, allow_inf_nan=False),
):
    if bright > mid:
        raise HTTPException(422, "Highlight coverage cannot exceed total dot coverage.")
    if request.headers.get("content-type") != "application/octet-stream":
        raise HTTPException(415, "Send an image file as application/octet-stream.")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "Choose an image smaller than 12 MB.")
    async with conversion_lock:
        if await request.is_disconnected():
            raise HTTPException(499, "Conversion cancelled.")
        return await run_in_threadpool(convert, data, rows, bright, mid, blur, mix, zoom, x, y, invert, cutoff, feather)


app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")

if __name__ == "__main__":
    print("Dot Studio: http://127.0.0.1:8765", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=8765, access_log=False)
