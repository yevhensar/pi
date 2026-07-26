import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CameraCapture, CameraHealth } from "@pi-health/shared";

const CAMERA_BACKENDS = ["rpicam-still", "libcamera-still"] as const;
const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 720;
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;

type CameraBackend = (typeof CAMERA_BACKENDS)[number];
let cameraQueue: Promise<void> = Promise.resolve();

export async function withCameraAccess<T>(operation: () => Promise<T>): Promise<T> {
  const previous = cameraQueue;
  let release = () => {};
  cameraQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

type ProcessResult = {
  stdout: string;
  stderr: string;
};

function run(
  executable: string,
  args: string[],
  timeout = 10_000
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout, maxBuffer: 256 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(stderr.trim() || error.message) as Error & {
            code?: string | number | null;
          };
          failure.code = error.code;
          reject(failure);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}

export function parseCameraList(output: string): {
  available: boolean;
  model: string | undefined;
} {
  const match = output.match(/^\s*\d+\s*:\s*([^\[]+)/m);
  return {
    available: Boolean(match) && !/no cameras available/i.test(output),
    model: match?.[1]?.trim()
  };
}

async function inspectBackend(backend: CameraBackend): Promise<CameraHealth | null> {
  try {
    const result = await run(backend, ["--list-cameras"], 5_000);
    const details = `${result.stdout}\n${result.stderr}`.trim();
    const parsed = parseCameraList(details);
    if (!parsed.available) {
      return {
        status: "missing",
        checkedAt: new Date().toISOString(),
        available: false,
        backend,
        details: details || "No cameras reported"
      };
    }
    return {
      status: "healthy",
      checkedAt: new Date().toISOString(),
      available: true,
      backend,
      model: parsed.model,
      details
    };
  } catch (error) {
    const failure = error as Error & { code?: string | number | null };
    if (failure.code === "ENOENT") return null;
    const busy = /busy|in use|resource temporarily unavailable/i.test(failure.message);
    return {
      status: busy ? "busy" : "error",
      checkedAt: new Date().toISOString(),
      available: false,
      backend,
      error: failure.message
    };
  }
}

async function cameraHealthUnlocked(): Promise<CameraHealth> {
  let missing: CameraHealth | undefined;
  for (const backend of CAMERA_BACKENDS) {
    const health = await inspectBackend(backend);
    if (!health) continue;
    if (health.available || health.status !== "missing") return health;
    missing = health;
  }
  return missing ?? {
    status: "missing",
    checkedAt: new Date().toISOString(),
    available: false,
    error: "Neither rpicam-still nor libcamera-still is installed"
  };
}

export function cameraHealth(): Promise<CameraHealth> {
  return withCameraAccess(cameraHealthUnlocked);
}

export async function captureCameraPhoto(
  profile: "capture" | "preview" | "detection" = "capture"
): Promise<CameraCapture> {
  return withCameraAccess(async () => {
  const health = await cameraHealthUnlocked();
  if (!health.available || !health.backend) {
    throw new Error(health.error ?? health.details ?? "Camera is unavailable");
  }

  const captureDirectory = await mkdtemp(join(tmpdir(), "pi-camera-"));
  const outputPath = join(captureDirectory, "capture.jpg");
  const width = profile === "preview" ? PREVIEW_WIDTH : CAPTURE_WIDTH;
  const height = profile === "preview" ? PREVIEW_HEIGHT : CAPTURE_HEIGHT;
  const quality = profile === "preview" ? "65" : profile === "detection" ? "75" : "85";
  const warmupMs = profile === "capture" ? "1000" : "300";
  try {
    await run(
      health.backend,
      [
        "--output", outputPath,
        "--width", String(width),
        "--height", String(height),
        "--encoding", "jpg",
        "--quality", quality,
        "--nopreview",
        "--timeout", warmupMs
      ],
      10_000
    );
    const metadata = await stat(outputPath);
    if (metadata.size <= 0) throw new Error("Camera produced an empty image");
    if (metadata.size > MAX_CAPTURE_BYTES) {
      throw new Error(`Captured image exceeds the ${MAX_CAPTURE_BYTES} byte limit`);
    }
    const image = await readFile(outputPath);
    if (image[0] !== 0xff || image[1] !== 0xd8) {
      throw new Error("Camera output is not a valid JPEG");
    }
    return {
      success: true,
      capturedAt: new Date().toISOString(),
      backend: health.backend,
      mimeType: "image/jpeg",
      width,
      height,
      sizeBytes: metadata.size,
      imageBase64: image.toString("base64")
    };
  } finally {
    await rm(captureDirectory, { recursive: true, force: true });
  }
  });
}
