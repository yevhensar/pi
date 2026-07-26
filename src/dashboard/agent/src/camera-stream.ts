import { spawn, type ChildProcess } from "node:child_process";
import { config } from "./config.js";

export type CameraStreamState = {
  status: "disabled" | "stopped" | "starting" | "live" | "error";
  width: number;
  height: number;
  fps: number;
  startedAt?: string;
  error?: string;
};

let cameraProcess: ChildProcess | undefined;
let publisherProcess: ChildProcess | undefined;
let state: CameraStreamState = baseState();

function baseState(): CameraStreamState {
  return {
    status: config.cameraStreamEnabled ? "stopped" : "disabled",
    width: config.cameraStreamWidth,
    height: config.cameraStreamHeight,
    fps: config.cameraStreamFps
  };
}

function stopChild(child: ChildProcess | undefined) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
}

async function stopChildAndWait(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 2_000);
    const finish = () => {
      clearTimeout(forceTimer);
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
  });
}

export function cameraStreamState(): CameraStreamState {
  return { ...state };
}

export async function startCameraStream(): Promise<CameraStreamState> {
  if (!config.cameraStreamEnabled) throw new Error("Camera streaming is disabled");
  if (state.status === "live" || state.status === "starting") return cameraStreamState();

  state = { ...baseState(), status: "starting" };
  // Recent libcamera builds release the PiSP pipeline asynchronously after a
  // still capture. Starting immediately can fail with /dev/video "Broken pipe".
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const camera = spawn(config.cameraStreamExecutable, [
    "--timeout", "0",
    "--nopreview",
    "--codec", "h264",
    "--libav-format", "h264",
    "--profile", "baseline",
    "--inline",
    "--width", String(config.cameraStreamWidth),
    "--height", String(config.cameraStreamHeight),
    "--framerate", String(config.cameraStreamFps),
    "--bitrate", String(config.cameraStreamBitrate),
    "--output", "-"
  ], { stdio: ["ignore", "pipe", "pipe"] });
  const publisher = spawn(config.cameraStreamFfmpeg, [
    "-hide_banner",
    "-loglevel", "warning",
    "-fflags", "nobuffer",
    "-f", "h264",
    "-framerate", String(config.cameraStreamFps),
    "-i", "pipe:0",
    "-an",
    "-c:v", "copy",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    config.cameraStreamPublishUrl
  ], { stdio: ["pipe", "ignore", "pipe"] });

  camera.stdout.pipe(publisher.stdin);
  cameraProcess = camera;
  publisherProcess = publisher;
  let stderr = "";
  camera.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
  publisher.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });

  const failed = (label: string) => (code: number | null, signal: NodeJS.Signals | null) => {
    if (state.status === "stopped") return;
    stopChild(cameraProcess);
    stopChild(publisherProcess);
    cameraProcess = undefined;
    publisherProcess = undefined;
    state = {
      ...baseState(),
      status: "error",
      error: `${label} exited (${signal ?? code ?? "unknown"})${stderr.trim() ? `: ${stderr.trim()}` : ""}`
    };
  };
  camera.once("exit", failed("rpicam-vid"));
  publisher.once("exit", failed("FFmpeg publisher"));

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 750);
    camera.once("error", (error) => { clearTimeout(timer); reject(error); });
    publisher.once("error", (error) => { clearTimeout(timer); reject(error); });
  }).catch((error) => {
    stopChild(camera);
    stopChild(publisher);
    state = { ...baseState(), status: "error", error: error instanceof Error ? error.message : "Stream failed" };
    throw error;
  });

  if (state.status === "error") throw new Error(state.error);
  state = { ...baseState(), status: "live", startedAt: new Date().toISOString() };
  return cameraStreamState();
}

export async function stopCameraStream(): Promise<CameraStreamState> {
  state = { ...baseState(), status: config.cameraStreamEnabled ? "stopped" : "disabled" };
  const camera = cameraProcess;
  const publisher = publisherProcess;
  cameraProcess = undefined;
  publisherProcess = undefined;
  await Promise.all([stopChildAndWait(camera), stopChildAndWait(publisher)]);
  return cameraStreamState();
}

export async function withCameraStreamPaused<T>(operation: () => Promise<T>): Promise<T> {
  const restore = state.status === "live";
  if (restore) {
    await stopCameraStream();
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  try {
    return await operation();
  } finally {
    if (restore) await startCameraStream();
  }
}
