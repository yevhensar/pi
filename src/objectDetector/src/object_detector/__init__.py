"""Extensible object detection package."""

from object_detector.core.types import BoundingBox, Detection
from object_detector.registry import available_detectors, create_detector, register_detector

__all__ = [
    "BoundingBox",
    "Detection",
    "available_detectors",
    "create_detector",
    "register_detector",
]
