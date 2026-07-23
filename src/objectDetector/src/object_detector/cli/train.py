from __future__ import annotations

import argparse
from pathlib import Path

import lightning as L
import torch
from lightning.pytorch.callbacks import ModelCheckpoint
from lightning.pytorch.callbacks.progress import TQDMProgressBar
from torchdata.stateful_dataloader import StatefulDataLoader

from object_detector.datasets import YoloDetectionDataset, detection_collate
from object_detector.models.faster_rcnn import FasterRCNNModule


PROJECT_ROOT = Path(__file__).resolve().parents[3]


class KnownTotalProgressBar(TQDMProgressBar):
    """Use dataset-derived totals when Lightning treats a restored loader as unsized."""

    def __init__(self, train_batches: int, val_batches: int, refresh_rate: int = 5) -> None:
        super().__init__(refresh_rate=refresh_rate)
        self._known_train_batches = train_batches
        self._known_val_batches = val_batches

    @property
    def total_train_batches(self) -> int:
        return self._known_train_batches

    @property
    def total_val_batches_current_dataloader(self) -> int:
        return self._known_val_batches

    def _set_epoch_description(self, trainer: L.Trainer) -> None:
        if self.train_progress_bar is not None:
            self.train_progress_bar.set_description(
                f"Epoch {trainer.current_epoch + 1}/{trainer.max_epochs}"
            )

    def on_train_start(
        self, trainer: L.Trainer, pl_module: L.LightningModule
    ) -> None:
        super().on_train_start(trainer, pl_module)
        # A mid-epoch resume may not invoke on_train_epoch_start immediately.
        self.train_progress_bar.total = self._known_train_batches
        self.train_progress_bar.initial = 0
        self._set_epoch_description(trainer)

    def on_train_epoch_start(
        self, trainer: L.Trainer, pl_module: L.LightningModule
    ) -> None:
        super().on_train_epoch_start(trainer, pl_module)
        self._set_epoch_description(trainer)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the Faster R-CNN vehicle detector")
    parser.add_argument(
        "--data-dir", type=Path, default=Path("data/VisDrone/processed")
    )
    parser.add_argument("--device", default="cpu", help="cpu, 0, cuda:0, or mps")
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=0.005)
    parser.add_argument(
        "--classes", type=int, default=1, help="Number of foreground classes in the dataset"
    )
    parser.add_argument(
        "--checkpoint-every",
        type=int,
        default=100,
        help="Save a resumable checkpoint every N optimizer steps",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Start a new run instead of skipping or resuming the existing run",
    )
    return parser.parse_args()


def trainer_device(value: str) -> tuple[str, int | list[int], str]:
    if value == "cpu":
        return "cpu", 1, "32-true"
    if value == "mps":
        return "mps", 1, "32-true"
    index = int(value.removeprefix("cuda:"))
    return "gpu", [index], "16-mixed"


def checkpoint_is_resumable(path: Path) -> bool:
    """Reject partial exception checkpoints that cannot restore optimizer state."""
    try:
        checkpoint = torch.load(path, map_location="cpu", weights_only=False)
        optimizer_states = checkpoint.get("optimizer_states", [])
        return bool(
            checkpoint.get("state_dict")
            and checkpoint.get("loops")
            and optimizer_states
            and optimizer_states[0].get("state")
        )
    except Exception as error:
        print(f"Ignoring unreadable checkpoint {path}: {error}")
        return False


def select_resume_checkpoint(checkpoint_dir: Path) -> Path | None:
    candidates: list[Path] = []
    last_checkpoint = checkpoint_dir / "last.ckpt"
    if last_checkpoint.exists():
        candidates.append(last_checkpoint)

    def checkpoint_step(path: Path) -> int:
        try:
            return int(path.stem.rsplit("=", 1)[-1])
        except ValueError:
            return -1

    candidates.extend(
        sorted(checkpoint_dir.glob("step-step=*.ckpt"), key=checkpoint_step, reverse=True)
    )
    seen: set[Path] = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if checkpoint_is_resumable(candidate):
            return candidate
        print(f"Ignoring incomplete checkpoint: {candidate}")
    return None


def main() -> None:
    args = parse_args()
    data_dir = args.data_dir if args.data_dir.is_absolute() else PROJECT_ROOT / args.data_dir
    run_dir = PROJECT_ROOT / "outputs" / "fasterrcnn"
    checkpoint_dir = run_dir / "checkpoints"
    last_checkpoint = checkpoint_dir / "last.ckpt"
    completion_marker = run_dir / ".training-complete"

    if completion_marker.exists() and not args.force:
        print(f"Training is already complete; skipping. Checkpoint: {last_checkpoint}")
        print("Use --force only when you intentionally want to train again.")
        return
    if args.force:
        completion_marker.unlink(missing_ok=True)

    train_dataset = YoloDetectionDataset(data_dir, "train", augment=True)
    val_dataset = YoloDetectionDataset(data_dir, "val")
    train_loader = StatefulDataLoader(
        train_dataset,
        batch_size=args.batch,
        shuffle=True,
        num_workers=args.workers,
        collate_fn=detection_collate,
        persistent_workers=args.workers > 0,
        snapshot_every_n_steps=args.checkpoint_every,
    )
    val_loader = StatefulDataLoader(
        val_dataset,
        batch_size=args.batch,
        shuffle=False,
        num_workers=args.workers,
        collate_fn=detection_collate,
        persistent_workers=args.workers > 0,
        snapshot_every_n_steps=args.checkpoint_every,
    )

    checkpoint = ModelCheckpoint(
        dirpath=checkpoint_dir,
        filename="step-{step:08d}",
        every_n_train_steps=args.checkpoint_every,
        save_top_k=-1,
        save_last=True,
        # Exception-time checkpoints can be captured before optimizer restoration and
        # overwrite a healthy `last.ckpt`. Periodic checkpoints are safer resume points.
        save_on_exception=False,
        save_on_train_epoch_end=True,
    )
    progress_bar = KnownTotalProgressBar(
        train_batches=len(train_loader), val_batches=len(val_loader), refresh_rate=5
    )
    accelerator, devices, precision = trainer_device(args.device)
    trainer = L.Trainer(
        accelerator=accelerator,
        devices=devices,
        precision=precision,
        max_epochs=args.epochs,
        callbacks=[checkpoint, progress_bar],
        default_root_dir=run_dir,
        log_every_n_steps=10,
        limit_train_batches=len(train_loader),
        limit_val_batches=len(val_loader),
        enable_progress_bar=True,
    )

    selected_checkpoint = None if args.force else select_resume_checkpoint(checkpoint_dir)
    resume_from = str(selected_checkpoint) if selected_checkpoint else None
    if resume_from:
        saved = torch.load(selected_checkpoint, map_location="cpu", weights_only=False)
        current_step = int(saved.get("global_step", 0))
        current_epoch = int(saved.get("epoch", 0))
        print(f"Resuming from step checkpoint: {resume_from}")
        print(
            f"Progress: epoch {current_epoch + 1}/{args.epochs}, "
            f"global step {current_step}/{len(train_loader) * args.epochs}, "
            f"{len(train_loader)} training batches per epoch"
        )
        # The original run used Torchvision's pretrained detector, whose backbone uses
        # FrozenBatchNorm. Recreate the same architecture before restoring its state.
        model = FasterRCNNModule(pretrained=True, num_classes=args.classes)
    else:
        print(
            f"Starting {args.epochs} epochs with {len(train_loader)} training batches "
            f"and {len(val_loader)} validation batches per epoch"
        )
        model = FasterRCNNModule(
            learning_rate=args.learning_rate, num_classes=args.classes
        )

    trainer.fit(model, train_loader, val_loader, ckpt_path=resume_from)
    trainer.save_checkpoint(last_checkpoint)
    completion_marker.parent.mkdir(parents=True, exist_ok=True)
    completion_marker.write_text("complete\n", encoding="utf-8")
    print(f"Training complete. Checkpoint: {last_checkpoint}")


if __name__ == "__main__":
    main()
