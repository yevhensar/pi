# Aerial vehicle detector

Faster R-CNN vehicle detection for aerial photos, trained with PyTorch Lightning and
Torchvision. Training saves resumable checkpoints during an epoch instead of waiting for
the complete epoch.

Run all commands below from this directory:

```bash
cd /home/sarjick/projects/vector-sky-labs/pi/src/objectDetector
```

## Setup

Create a virtual environment and install the project:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e .
```

For the HTTP API, install the optional dependencies:

```bash
python -m pip install -e '.[api]'
```

Verify whether Torch can use an NVIDIA GPU:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Install the matching CUDA build of PyTorch first if the machine has an NVIDIA GPU but
this prints `False`.

## Prepare VisDrone

The preparation script downloads VisDrone2019-DET and combines its `car`, `van`, `truck`,
and `bus` categories into one `vehicle` class:

```bash
python src/prepare_visdrone.py
```

The command is safe to run repeatedly. Completed splits are skipped before downloading.
Interrupted archive transfers resume from their retained `.part` files when supported by
the server. All files remain under `data/VisDrone/` and are ignored by Git.

The prepared annotations remain in YOLO text format, but the Torchvision data loader
converts them to pixel bounding boxes in memory. Ultralytics is not required.

## Train

CPU training with a checkpoint every 100 optimizer steps:

```bash
python src/train.py --device cpu --batch 2 --checkpoint-every 100
```

Training on the first NVIDIA GPU:

```bash
python src/train.py --device 0 --batch 4 --checkpoint-every 100
```

The first fresh run downloads Torchvision's pretrained Faster R-CNN MobileNetV3-FPN
weights. Training checkpoints are saved beneath:

```text
outputs/fasterrcnn/checkpoints/
├── last.ckpt
└── step-step=00000100.ckpt
```

Run the same command after an interruption. If `last.ckpt` exists, Lightning restores the
model, optimizer, learning-rate scheduler, epoch, and training step:

```bash
python src/train.py --device cpu --batch 2 --checkpoint-every 100
```

At most the batches since the most recent checkpoint need to be repeated. Lower
`--checkpoint-every` to reduce lost work, at the cost of more frequent disk writes.

Training uses TorchData's `StatefulDataLoader`. Its sampler position is included in new
checkpoints, so a future mid-epoch resume continues with the next shuffled batch instead
of restarting or ambiguously replaying the epoch. Older checkpoints created before this
loader was enabled can restore model and optimizer state but do not contain loader state;
the first resume from one of those may still repeat or skip samples in that one epoch.

At startup, the trainer prints the resumed epoch, global step, total planned steps, and
batches per epoch. A custom TQDM progress callback uses the dataset-derived train and
validation batch counts directly, so even a restored stateful loader displays a numeric
current/total value instead of `?`. Its label uses one-based numbering such as
`Epoch 9/20`, including immediately after a mid-epoch resume.

Unreadable or corrupt images are reported as warnings and removed from their batch rather
than stopping training. Malformed, non-numeric, non-finite, and non-positive annotation
boxes are ignored. If every image in one batch fails, Lightning skips that empty batch and
continues. Resume selection also rejects incomplete checkpoints without optimizer state
and falls back to the newest healthy step checkpoint.

After successful completion, another invocation skips training. To intentionally start a
new run from the pretrained backbone:

```bash
python src/train.py --device cpu --batch 2 --force
```

The previous Ultralytics checkpoint, if any, is incompatible with Faster R-CNN. Prepared
images and labels are fully reusable.

## Predict

Run overlapping tiled inference on one image:

```bash
python src/predict.py \
  photos/istockphoto-1413970631-1024x1024.jpg \
  --model outputs/fasterrcnn/checkpoints/last.ckpt \
  --device cpu
```

Use `--device cuda:0` for the first NVIDIA GPU. Prediction creates:

```text
outputs/detections.json
outputs/annotated.jpg
```

Optional inference controls:

```bash
python src/predict.py IMAGE \
  --model CHECKPOINT \
  --confidence 0.35 \
  --slice-size 512 \
  --overlap 0.2
```

## Evaluate

First run a short smoke evaluation:

```bash
python src/evaluate.py \
  --model outputs/fasterrcnn/checkpoints/last.ckpt \
  --split test \
  --device cpu \
  --limit 20
```

Remove `--limit` to evaluate all test images. The command reports true positives, false
positives, false negatives, precision, recall, and F1 at the selected confidence and IoU
thresholds.

## API

Install the API dependencies and start the server from the project directory. The server
uses `outputs/fasterrcnn/checkpoints/last.ckpt` by default:

```bash
pip install -e '.[api]'
DEVICE=cpu uvicorn service:app --app-dir src --port 8000
```

Use `DEVICE=cuda:0` to run inference on the first NVIDIA GPU. The interactive API docs
are available at `http://localhost:8000/docs`.

Send an image as multipart form data:

```bash
curl -F file=@photos/istockphoto-1413970631-1024x1024.jpg \
  http://localhost:8000/api/detect
```

The response contains `car_present`, the detection count, confidence scores, and bounding
box coordinates.

## React client

In a second terminal, start the upload interface:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`. The Vite development server proxies `/api` requests to the
API on port 8000. To use an API hosted elsewhere, set `VITE_API_URL` to its complete
detect endpoint before starting or building the client.

## Custom data

Place one-class YOLO detection images and matching labels in:

```text
data/images/{train,val,test}/image-name.jpg
data/labels/{train,val,test}/image-name.txt
```

Train with:

```bash
python src/train.py --data-dir data
```

Split by flight, date, or location rather than randomly splitting neighboring photos.

## Commit the project

```bash
cd /home/sarjick/projects/vector-sky-labs/pi
git add src/objectDetector
git commit -m "Add resumable Faster R-CNN vehicle detector"
```

Downloaded datasets, pretrained `.pt` files, `.ckpt` checkpoints, generated outputs,
virtual environments, and Python caches are excluded by `.gitignore`.

## Licensing

Torch and Torchvision use BSD-style licenses, and Lightning uses Apache-2.0. Confirm the
VisDrone dataset terms are compatible with the intended use and retain its attribution.
