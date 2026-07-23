from __future__ import annotations

import argparse
import shutil
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image


ASSET_ROOT = "https://github.com/ultralytics/assets/releases/download/v0.0.0"
ARCHIVES = {
    "train": "VisDrone2019-DET-train.zip",
    "val": "VisDrone2019-DET-val.zip",
    "test": "VisDrone2019-DET-test-dev.zip",
}
EXPECTED_IMAGE_COUNTS = {"train": 6471, "val": 548, "test": 1610}
# VisDrone category IDs are one-based: car=4, van=5, truck=6, bus=9.
VEHICLE_CATEGORY_IDS = {4, 5, 6, 9}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download VisDrone2019-DET and convert road vehicles to one YOLO class"
    )
    parser.add_argument("--data-dir", type=Path, default=Path("data/VisDrone"))
    parser.add_argument(
        "--keep-archives",
        action="store_true",
        help="Keep downloaded ZIP archives after successful extraction",
    )
    return parser.parse_args()


def safe_extract(archive: Path, destination: Path) -> None:
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            target = (destination / member.filename).resolve()
            if destination not in target.parents and target != destination:
                raise ValueError(f"Unsafe path in {archive}: {member.filename}")
        zipped.extractall(destination)


def download_archive(filename: str, destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / filename
    if archive.exists():
        print(f"Using existing {archive}")
        return archive

    partial = archive.with_suffix(archive.suffix + ".part")
    downloaded = partial.stat().st_size if partial.exists() else 0
    request = urllib.request.Request(f"{ASSET_ROOT}/{filename}")
    if downloaded:
        request.add_header("Range", f"bytes={downloaded}-")
        print(f"Resuming {filename} from {downloaded / 1024**2:.1f} MiB ...", flush=True)
    else:
        print(f"Downloading {filename} ...", flush=True)

    try:
        with urllib.request.urlopen(request) as response:
            resume_accepted = response.status == 206
            mode = "ab" if downloaded and resume_accepted else "wb"
            with partial.open(mode) as output:
                shutil.copyfileobj(response, output, length=1024 * 1024)
        partial.replace(archive)
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    return archive


def convert_split(source: Path, output: Path, split: str) -> tuple[int, int]:
    source_images = source / "images"
    source_labels = source / "annotations"
    output_images = output / "images" / split
    output_labels = output / "labels" / split
    output_images.mkdir(parents=True, exist_ok=True)
    output_labels.mkdir(parents=True, exist_ok=True)

    image_count = 0
    vehicle_count = 0
    for image_path in sorted(source_images.glob("*.jpg")):
        with Image.open(image_path) as image:
            width, height = image.size
        annotation_path = source_labels / f"{image_path.stem}.txt"
        lines: list[str] = []

        if annotation_path.exists():
            for raw_line in annotation_path.read_text(encoding="utf-8").splitlines():
                fields = raw_line.split(",")
                if len(fields) < 8:
                    continue
                x, y, box_width, box_height = map(float, fields[:4])
                score = int(fields[4])
                category_id = int(fields[5])
                if score == 0 or category_id not in VEHICLE_CATEGORY_IDS:
                    continue

                center_x = (x + box_width / 2) / width
                center_y = (y + box_height / 2) / height
                normalized_width = box_width / width
                normalized_height = box_height / height
                lines.append(
                    "0 "
                    f"{center_x:.6f} {center_y:.6f} "
                    f"{normalized_width:.6f} {normalized_height:.6f}\n"
                )
                vehicle_count += 1

        shutil.copy2(image_path, output_images / image_path.name)
        (output_labels / f"{image_path.stem}.txt").write_text(
            "".join(lines), encoding="utf-8"
        )
        image_count += 1

    return image_count, vehicle_count


def split_is_complete(output: Path, split: str) -> bool:
    marker = output / f".{split}.complete"
    if marker.exists():
        return True

    # Recognize datasets prepared by an older version of this script, before markers
    # were introduced. Require the official number of both images and label files.
    images = output / "images" / split
    labels = output / "labels" / split
    expected = EXPECTED_IMAGE_COUNTS[split]
    if images.is_dir() and labels.is_dir():
        image_count = sum(1 for path in images.glob("*.jpg") if path.is_file())
        label_count = sum(1 for path in labels.glob("*.txt") if path.is_file())
        if image_count == expected and label_count == expected:
            marker.write_text(
                f"images={image_count}\nlabels={label_count}\n", encoding="utf-8"
            )
            return True
    return False


def main() -> None:
    args = parse_args()
    raw_dir = args.data_dir / "raw"
    extracted_dir = raw_dir / "extracted"
    output_dir = args.data_dir / "processed"

    for split, filename in ARCHIVES.items():
        if split_is_complete(output_dir, split):
            print(f"{split}: already prepared, skipping", flush=True)
            continue

        archive = download_archive(filename, raw_dir)
        source_name = filename.removesuffix(".zip")
        source = extracted_dir / source_name
        if not source.exists():
            print(f"Extracting {archive} ...")
            safe_extract(archive, extracted_dir)
        images, vehicles = convert_split(source, output_dir, split)
        if images != EXPECTED_IMAGE_COUNTS[split]:
            raise RuntimeError(
                f"Expected {EXPECTED_IMAGE_COUNTS[split]} {split} images, found {images}"
            )
        (output_dir / f".{split}.complete").write_text(
            f"images={images}\nvehicles={vehicles}\n", encoding="utf-8"
        )
        print(f"{split}: {images} images, {vehicles} vehicle boxes")
        if not args.keep_archives:
            archive.unlink(missing_ok=True)

    print(f"Prepared dataset at {output_dir}")


if __name__ == "__main__":
    main()
