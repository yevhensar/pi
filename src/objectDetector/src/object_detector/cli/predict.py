from __future__ import annotations

import argparse
import json
from pathlib import Path

from object_detector.registry import create_detector


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Detect objects in an image")
    parser.add_argument("image", type=Path)
    parser.add_argument("--model", type=Path, default=Path("models/last.ckpt"))
    parser.add_argument("--backend", default="faster-rcnn", help="Registered model backend")
    parser.add_argument("--device", default="cpu", help="Use cpu, cuda:0, mps, etc.")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--slice-size", type=int, default=512)
    parser.add_argument("--overlap", type=float, default=0.2)
    parser.add_argument("--output", type=Path, default=Path("outputs/detections.json"))
    parser.add_argument(
        "--annotated-output",
        type=Path,
        default=Path("outputs/annotated.jpg"),
        help="Annotated image output",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    detector = create_detector(
        args.backend,
        model_path=args.model,
        device=args.device,
        confidence=args.confidence,
        slice_size=args.slice_size,
        overlap=args.overlap,
    )
    detections = detector.predict(args.image)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps([detection.to_dict() for detection in detections], indent=2) + "\n",
        encoding="utf-8",
    )
    if args.annotated_output:
        detector.save_annotated(args.image, detections, args.annotated_output)
    print(f"Found {len(detections)} object(s); wrote {args.output}")


if __name__ == "__main__":
    main()
