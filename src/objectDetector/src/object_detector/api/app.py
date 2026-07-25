from __future__ import annotations

import os
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, UnidentifiedImageError

from object_detector.core.detector import BaseDetector
from object_detector.registry import create_detector


detector: BaseDetector | None = None
PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODEL_PATH = PROJECT_ROOT / "outputs/fasterrcnn/checkpoints/last.ckpt"
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(_: FastAPI):
    global detector
    class_names = tuple(
        name.strip() for name in os.getenv("CLASS_NAMES", "vehicle").split(",") if name.strip()
    )
    detector = create_detector(
        os.getenv("MODEL_BACKEND", "faster-rcnn"),
        model_path=os.getenv("MODEL_PATH", str(DEFAULT_MODEL_PATH)),
        device=os.getenv("DEVICE", "cpu"),
        confidence=float(os.getenv("CONFIDENCE", "0.25")),
        class_names=class_names,
        slice_size=int(os.getenv("SLICE_SIZE", "512")),
        overlap=float(os.getenv("SLICE_OVERLAP", "0.2")),
    )
    yield
    detector = None


app = FastAPI(title="Object Detector", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok" if detector is not None else "loading"}


@app.post("/api/detect")
async def detect_objects(file: UploadFile = File(...)) -> dict:
    if detector is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")

    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=415, detail="Please upload an image file")

    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded image is empty")
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image must be 20 MB or smaller")

    try:
        with Image.open(BytesIO(contents)) as image:
            image.verify()
    except (UnidentifiedImageError, OSError):
        raise HTTPException(status_code=400, detail="The uploaded file is not a valid image")

    suffix = Path(file.filename or "image.jpg").suffix or ".jpg"
    with NamedTemporaryFile(suffix=suffix) as temporary:
        temporary.write(contents)
        temporary.flush()
        started = time.perf_counter()
        detections = detector.predict(temporary.name)
        inference_ms = round((time.perf_counter() - started) * 1000)

    count = len(detections)
    return {
        "object_present": count > 0,
        # Deprecated compatibility field for the original car-detector client.
        "car_present": count > 0,
        "count": count,
        "inference_ms": inference_ms,
        "detections": [detection.to_dict() for detection in detections],
    }


# Keep the original endpoint available for existing scripts and integrations.
@app.post("/detect", include_in_schema=False)
async def detect_cars_legacy(file: UploadFile = File(...)) -> dict:
    return await detect_objects(file)
