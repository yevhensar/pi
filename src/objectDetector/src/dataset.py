from __future__ import annotations

import random
import warnings
from math import isfinite
from pathlib import Path

import torch
from PIL import Image
from torch.utils.data import Dataset
from torchvision.transforms.functional import pil_to_tensor


class YoloVehicleDataset(Dataset):
    """Read one-class YOLO labels and return Torchvision detection targets."""

    def __init__(self, root: str | Path, split: str, *, augment: bool = False) -> None:
        self.root = Path(root)
        self.image_dir = self.root / "images" / split
        self.label_dir = self.root / "labels" / split
        self.augment = augment
        self.images = sorted(self.image_dir.glob("*.jpg"))
        if not self.images:
            raise FileNotFoundError(f"No images found in {self.image_dir}")

    def __len__(self) -> int:
        return len(self.images)

    def __getitem__(
        self, index: int
    ) -> tuple[torch.Tensor, dict[str, torch.Tensor]] | None:
        image_path = self.images[index]
        try:
            return self._load_item(index, image_path)
        except Exception as error:
            warnings.warn(
                f"Skipping unreadable training image {image_path}: {error}",
                stacklevel=2,
            )
            return None

    def _load_item(
        self, index: int, image_path: Path
    ) -> tuple[torch.Tensor, dict[str, torch.Tensor]]:
        with Image.open(image_path) as source:
            source.load()
            image = pil_to_tensor(source.convert("RGB")).float().div(255)
        height, width = image.shape[-2:]

        boxes: list[list[float]] = []
        label_path = self.label_dir / f"{image_path.stem}.txt"
        if label_path.exists():
            for line_number, line in enumerate(
                label_path.read_text(encoding="utf-8").splitlines(), start=1
            ):
                fields = line.split()
                if len(fields) != 5:
                    warnings.warn(
                        f"Ignoring malformed label {label_path}:{line_number}", stacklevel=2
                    )
                    continue
                try:
                    _, center_x, center_y, box_width, box_height = map(float, fields)
                except ValueError:
                    warnings.warn(
                        f"Ignoring non-numeric label {label_path}:{line_number}", stacklevel=2
                    )
                    continue
                if not all(isfinite(value) for value in (center_x, center_y, box_width, box_height)):
                    warnings.warn(
                        f"Ignoring non-finite box {label_path}:{line_number}", stacklevel=2
                    )
                    continue
                if box_width <= 0 or box_height <= 0:
                    warnings.warn(
                        f"Ignoring non-positive box {label_path}:{line_number}", stacklevel=2
                    )
                    continue
                center_x *= width
                center_y *= height
                box_width *= width
                box_height *= height
                boxes.append(
                    [
                        max(0.0, center_x - box_width / 2),
                        max(0.0, center_y - box_height / 2),
                        min(float(width), center_x + box_width / 2),
                        min(float(height), center_y + box_height / 2),
                    ]
                )

        box_tensor = torch.tensor(boxes, dtype=torch.float32).reshape(-1, 4)
        if self.augment and random.random() < 0.5:
            image = image.flip(-1)
            if len(box_tensor):
                old_x1 = box_tensor[:, 0].clone()
                box_tensor[:, 0] = width - box_tensor[:, 2]
                box_tensor[:, 2] = width - old_x1
        if self.augment and random.random() < 0.5:
            image = image.flip(-2)
            if len(box_tensor):
                old_y1 = box_tensor[:, 1].clone()
                box_tensor[:, 1] = height - box_tensor[:, 3]
                box_tensor[:, 3] = height - old_y1

        target = {
            "boxes": box_tensor,
            # Torchvision reserves class 0 for the background.
            "labels": torch.ones(len(box_tensor), dtype=torch.int64),
            "image_id": torch.tensor(index, dtype=torch.int64),
            "area": (
                (box_tensor[:, 2] - box_tensor[:, 0])
                * (box_tensor[:, 3] - box_tensor[:, 1])
            ),
            "iscrowd": torch.zeros(len(box_tensor), dtype=torch.int64),
        }
        return image, target


def detection_collate(batch):
    valid_items = [item for item in batch if item is not None]
    if not valid_items:
        return (), ()
    return tuple(zip(*valid_items, strict=True))
