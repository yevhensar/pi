from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True, slots=True)
class BoundingBox:
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass(frozen=True, slots=True)
class Detection:
    class_name: str
    confidence: float
    box: BoundingBox

    def to_dict(self) -> dict:
        result = asdict(self)
        result["class"] = result.pop("class_name")
        return result
