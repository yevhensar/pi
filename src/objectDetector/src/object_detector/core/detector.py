from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path

from object_detector.core.types import Detection


class BaseDetector(ABC):
    """Backend-independent inference contract."""

    @abstractmethod
    def predict(self, image_path: str | Path) -> list[Detection]:
        """Return normalized detections for one image."""

    def predict_dicts(self, image_path: str | Path) -> list[dict]:
        return [detection.to_dict() for detection in self.predict(image_path)]

    @abstractmethod
    def save_annotated(
        self, image_path: str | Path, detections: list[Detection], output_path: str | Path
    ) -> None:
        """Write an image annotated with the supplied detections."""
