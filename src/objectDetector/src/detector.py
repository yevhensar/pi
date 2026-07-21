from __future__ import annotations

from pathlib import Path
from typing import Any

import torch
from PIL import Image, ImageDraw
from torchvision.ops import nms
from torchvision.transforms.functional import pil_to_tensor

from modeling import VehicleDetectorModule


def _device_name(value: str) -> str:
    if value.isdigit():
        return f"cuda:{value}"
    return value


def _tile_origins(length: int, tile_size: int, overlap: float) -> list[int]:
    if length <= tile_size:
        return [0]
    stride = max(1, round(tile_size * (1 - overlap)))
    origins = list(range(0, length - tile_size + 1, stride))
    final_origin = length - tile_size
    if origins[-1] != final_origin:
        origins.append(final_origin)
    return origins


class CarDetector:
    """Load a Faster R-CNN Lightning checkpoint and run tiled vehicle inference."""

    def __init__(
        self,
        model_path: str | Path,
        *,
        device: str = "cpu",
        confidence: float = 0.25,
        slice_size: int = 512,
        overlap: float = 0.2,
    ) -> None:
        if not 0 <= overlap < 1:
            raise ValueError("overlap must be at least 0 and less than 1")
        self.device = torch.device(_device_name(device))
        self.confidence = confidence
        self.slice_size = slice_size
        self.overlap = overlap
        module = VehicleDetectorModule.load_from_checkpoint(
            str(model_path), map_location=self.device, pretrained=True
        )
        self.model = module.detector.to(self.device).eval()

    @torch.inference_mode()
    def predict(self, image_path: str | Path) -> list[dict[str, Any]]:
        with Image.open(image_path) as source:
            image = source.convert("RGB")

        all_boxes: list[torch.Tensor] = []
        all_scores: list[torch.Tensor] = []
        for top in _tile_origins(image.height, self.slice_size, self.overlap):
            for left in _tile_origins(image.width, self.slice_size, self.overlap):
                right = min(left + self.slice_size, image.width)
                bottom = min(top + self.slice_size, image.height)
                tile = image.crop((left, top, right, bottom))
                tensor = pil_to_tensor(tile).float().div(255).to(self.device)
                prediction = self.model([tensor])[0]
                keep = (prediction["labels"] == 1) & (
                    prediction["scores"] >= self.confidence
                )
                boxes = prediction["boxes"][keep]
                scores = prediction["scores"][keep]
                if len(boxes):
                    offset = boxes.new_tensor([left, top, left, top])
                    all_boxes.append(boxes + offset)
                    all_scores.append(scores)

        if not all_boxes:
            return []
        boxes = torch.cat(all_boxes)
        scores = torch.cat(all_scores)
        selected = nms(boxes, scores, iou_threshold=0.5)

        detections: list[dict[str, Any]] = []
        for box, score in zip(boxes[selected].cpu(), scores[selected].cpu(), strict=True):
            x1, y1, x2, y2 = box.tolist()
            detections.append(
                {
                    "class": "vehicle",
                    "confidence": round(float(score), 4),
                    "box": {
                        "x1": round(x1, 2),
                        "y1": round(y1, 2),
                        "x2": round(x2, 2),
                        "y2": round(y2, 2),
                    },
                }
            )
        return detections

    @staticmethod
    def save_annotated(
        image_path: str | Path,
        detections: list[dict[str, Any]],
        output_path: str | Path,
    ) -> None:
        with Image.open(image_path) as source:
            image = source.convert("RGB")
        draw = ImageDraw.Draw(image)
        for detection in detections:
            box = detection["box"]
            coordinates = (box["x1"], box["y1"], box["x2"], box["y2"])
            draw.rectangle(coordinates, outline="red", width=3)
            draw.text(
                (box["x1"], max(0, box["y1"] - 14)),
                f"vehicle {detection['confidence']:.2f}",
                fill="red",
            )
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        image.save(output)
