from pathlib import Path
from unittest import TestCase

from object_detector.core.detector import BaseDetector
from object_detector.core.types import BoundingBox, Detection
from object_detector.registry import create_detector, register_detector


class StubDetector(BaseDetector):
    def __init__(self, label: str) -> None:
        self.label = label

    def predict(self, image_path: str | Path) -> list[Detection]:
        return [Detection(self.label, 0.9, BoundingBox(1, 2, 3, 4))]

    def save_annotated(self, image_path, detections, output_path) -> None:
        return None


class DetectorRegistryTests(TestCase):
    def test_custom_detector_can_be_registered_and_created(self) -> None:
        register_detector("test-stub", StubDetector)
        detector = create_detector("test-stub", label="person")

        self.assertEqual(
            detector.predict_dicts("unused.jpg"),
            [
                {
                    "class": "person",
                    "confidence": 0.9,
                    "box": {"x1": 1, "y1": 2, "x2": 3, "y2": 4},
                }
            ],
        )

    def test_duplicate_registration_is_rejected(self) -> None:
        register_detector("test-duplicate", StubDetector)
        with self.assertRaisesRegex(ValueError, "already registered"):
            register_detector("test-duplicate", StubDetector)

    def test_unknown_detector_lists_available_backends(self) -> None:
        with self.assertRaisesRegex(ValueError, "faster-rcnn"):
            create_detector("missing")
