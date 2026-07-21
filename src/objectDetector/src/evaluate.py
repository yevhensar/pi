from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from dataset import YoloVehicleDataset
from detector import CarDetector


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Evaluate a vehicle checkpoint")
    parser.add_argument(
        "--model", type=Path, default=Path("outputs/fasterrcnn/checkpoints/last.ckpt")
    )
    parser.add_argument(
        "--data-dir", type=Path, default=Path("data/VisDrone/processed")
    )
    parser.add_argument("--split", choices=("train", "val", "test"), default="test")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument("--iou", type=float, default=0.5)
    parser.add_argument("--limit", type=int, help="Evaluate only the first N images")
    return parser.parse_args()


def intersection_over_union(first: torch.Tensor, second: torch.Tensor) -> torch.Tensor:
    if not len(first) or not len(second):
        return torch.zeros((len(first), len(second)))
    top_left = torch.maximum(first[:, None, :2], second[None, :, :2])
    bottom_right = torch.minimum(first[:, None, 2:], second[None, :, 2:])
    intersection = (bottom_right - top_left).clamp(min=0).prod(dim=2)
    first_area = (first[:, 2:] - first[:, :2]).prod(dim=1)[:, None]
    second_area = (second[:, 2:] - second[:, :2]).prod(dim=1)[None, :]
    return intersection / (first_area + second_area - intersection).clamp(min=1e-9)


def match_boxes(
    predicted: torch.Tensor, expected: torch.Tensor, threshold: float
) -> tuple[int, int, int]:
    scores = intersection_over_union(predicted, expected)
    matched_predictions: set[int] = set()
    matched_expected: set[int] = set()
    if scores.numel():
        candidates = torch.nonzero(scores >= threshold, as_tuple=False)
        ranked = sorted(
            candidates.tolist(), key=lambda pair: float(scores[pair[0], pair[1]]), reverse=True
        )
        for prediction_index, expected_index in ranked:
            if prediction_index in matched_predictions or expected_index in matched_expected:
                continue
            matched_predictions.add(prediction_index)
            matched_expected.add(expected_index)
    true_positive = len(matched_predictions)
    return true_positive, len(predicted) - true_positive, len(expected) - true_positive


def main() -> None:
    args = parse_args()
    model_path = args.model if args.model.is_absolute() else PROJECT_ROOT / args.model
    data_dir = args.data_dir if args.data_dir.is_absolute() else PROJECT_ROOT / args.data_dir
    dataset = YoloVehicleDataset(data_dir, args.split)
    detector = CarDetector(model_path, device=args.device, confidence=args.confidence)

    totals = {"true_positive": 0, "false_positive": 0, "false_negative": 0}
    count = min(len(dataset), args.limit) if args.limit else len(dataset)
    for index in range(count):
        _, target = dataset[index]
        detections = detector.predict(dataset.images[index])
        predicted = torch.tensor(
            [
                [
                    detection["box"]["x1"],
                    detection["box"]["y1"],
                    detection["box"]["x2"],
                    detection["box"]["y2"],
                ]
                for detection in detections
            ],
            dtype=torch.float32,
        ).reshape(-1, 4)
        true_positive, false_positive, false_negative = match_boxes(
            predicted, target["boxes"], args.iou
        )
        totals["true_positive"] += true_positive
        totals["false_positive"] += false_positive
        totals["false_negative"] += false_negative

    tp = totals["true_positive"]
    fp = totals["false_positive"]
    fn = totals["false_negative"]
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    result = {
        "images": count,
        **totals,
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "confidence_threshold": args.confidence,
        "iou_threshold": args.iou,
    }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
