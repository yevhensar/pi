from __future__ import annotations

import os
from contextlib import asynccontextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile

from fastapi import FastAPI, HTTPException, UploadFile

from detector import CarDetector


detector: CarDetector | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global detector
    detector = CarDetector(
        os.getenv("MODEL_PATH", "models/last.ckpt"),
        device=os.getenv("DEVICE", "cpu"),
    )
    yield
    detector = None


app = FastAPI(title="Aerial Car Detector", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok" if detector is not None else "loading"}


@app.post("/detect")
async def detect_cars(file: UploadFile) -> dict:
    if detector is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")

    suffix = Path(file.filename or "image.jpg").suffix or ".jpg"
    with NamedTemporaryFile(suffix=suffix) as temporary:
        temporary.write(await file.read())
        temporary.flush()
        detections = detector.predict(temporary.name)

    return {"count": len(detections), "detections": detections}
