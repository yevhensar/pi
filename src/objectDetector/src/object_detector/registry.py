from __future__ import annotations

from collections.abc import Callable
from typing import Any

from object_detector.core.detector import BaseDetector

DetectorFactory = Callable[..., BaseDetector]
_DETECTORS: dict[str, DetectorFactory] = {}


def register_detector(name: str, factory: DetectorFactory) -> None:
    key = name.strip().lower()
    if not key:
        raise ValueError("Detector name cannot be empty")
    if key in _DETECTORS:
        raise ValueError(f"Detector backend is already registered: {key}")
    _DETECTORS[key] = factory


def available_detectors() -> tuple[str, ...]:
    _register_builtins()
    return tuple(sorted(_DETECTORS))


def create_detector(name: str, **options: Any) -> BaseDetector:
    _register_builtins()
    key = name.strip().lower()
    try:
        factory = _DETECTORS[key]
    except KeyError as error:
        choices = ", ".join(available_detectors())
        raise ValueError(f"Unknown detector backend '{name}'. Available: {choices}") from error
    return factory(**options)


def _register_builtins() -> None:
    if "faster-rcnn" not in _DETECTORS:
        from object_detector.models.faster_rcnn import FasterRCNNDetector

        register_detector("faster-rcnn", FasterRCNNDetector)
