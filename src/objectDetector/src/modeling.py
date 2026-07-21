from __future__ import annotations

import lightning as L
import torch
from torchvision.models.detection import (
    FasterRCNN_MobileNet_V3_Large_FPN_Weights,
    fasterrcnn_mobilenet_v3_large_fpn,
)
from torchvision.models.detection.faster_rcnn import FastRCNNPredictor


class VehicleDetectorModule(L.LightningModule):
    """Lightning wrapper around a two-class Torchvision Faster R-CNN model."""

    def __init__(self, learning_rate: float = 0.005, pretrained: bool = True) -> None:
        super().__init__()
        self.save_hyperparameters()
        weights = FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT if pretrained else None
        self.detector = fasterrcnn_mobilenet_v3_large_fpn(
            weights=weights,
            weights_backbone=None,
            min_size=800,
            max_size=1333,
        )
        input_features = self.detector.roi_heads.box_predictor.cls_score.in_features
        self.detector.roi_heads.box_predictor = FastRCNNPredictor(input_features, 2)

    def forward(self, images: list[torch.Tensor]):
        return self.detector(images)

    def training_step(self, batch, batch_index: int) -> torch.Tensor | None:
        images, targets = batch
        if not images:
            self.print(f"Skipping empty training batch {batch_index}")
            return None
        losses = self.detector(list(images), list(targets))
        total_loss = sum(losses.values())
        self.log(
            "train_loss",
            total_loss,
            prog_bar=True,
            on_step=True,
            on_epoch=True,
            batch_size=len(images),
        )
        for name, loss in losses.items():
            self.log(
                f"train_{name}",
                loss,
                on_step=False,
                on_epoch=True,
                batch_size=len(images),
            )
        return total_loss

    def validation_step(self, batch, batch_index: int) -> None:
        images, targets = batch
        if not images:
            self.print(f"Skipping empty validation batch {batch_index}")
            return
        predictions = self.detector(list(images))
        predicted = sum(int((item["scores"] >= 0.25).sum()) for item in predictions)
        expected = sum(len(item["labels"]) for item in targets)
        self.log(
            "val_predicted_objects",
            float(predicted),
            on_step=False,
            on_epoch=True,
            batch_size=len(images),
        )
        self.log(
            "val_expected_objects",
            float(expected),
            on_step=False,
            on_epoch=True,
            batch_size=len(images),
        )

    def configure_optimizers(self):
        optimizer = torch.optim.SGD(
            (parameter for parameter in self.parameters() if parameter.requires_grad),
            lr=self.hparams.learning_rate,
            momentum=0.9,
            weight_decay=0.0005,
        )
        scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=3, gamma=0.1)
        return {"optimizer": optimizer, "lr_scheduler": scheduler}
