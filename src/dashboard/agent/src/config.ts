import os from "node:os";
import { fileURLToPath } from "node:url";

const healthIntervalMs = Number.parseInt(process.env.HEALTH_INTERVAL_MS ?? "60000", 10);
if (!Number.isFinite(healthIntervalMs) || healthIntervalMs < 1000) {
  throw new Error("HEALTH_INTERVAL_MS must be a number of at least 1000");
}

export const config = {
  serverUrl: process.env.SERVER_URL ?? "http://127.0.0.1:3000",
  deviceId: process.env.DEVICE_ID?.trim() || os.hostname(),
  messageToken: process.env.MESSAGE_TOKEN?.trim() || "",
  wifiInterface: process.env.WIFI_INTERFACE?.trim() || undefined,
  flightControllerEnabled: process.env.FLIGHT_CONTROLLER_ENABLED !== "false",
  flightControllerPython:
    process.env.FLIGHT_CONTROLLER_PYTHON ??
    (process.env.NODE_ENV === "production" ? "/opt/pi-health-agent/venv/bin/python" : "python3"),
  flightControllerScript:
    process.env.FLIGHT_CONTROLLER_SCRIPT ??
    fileURLToPath(new URL("../python/flight_controller_health.py", import.meta.url)),
  flightControllerDevice: process.env.FLIGHT_CONTROLLER_DEVICE?.trim() || "auto",
  flightControllerProtocol: process.env.FLIGHT_CONTROLLER_PROTOCOL?.trim() || "auto",
  flightControllerBaud: Number.parseInt(
    process.env.FLIGHT_CONTROLLER_BAUD ?? "115200",
    10
  ),
  flightControllerTimeoutMs: Number.parseInt(
    process.env.FLIGHT_CONTROLLER_TIMEOUT_MS ?? "8000",
    10
  ),
  motorTestEnabled: process.env.FLIGHT_CONTROLLER_MOTOR_TEST_ENABLED === "true",
  motorTestOutput: Number.parseInt(
    process.env.FLIGHT_CONTROLLER_MOTOR_TEST_OUTPUT ?? "1050",
    10
  ),
  motorTestDurationMs: Number.parseInt(
    process.env.FLIGHT_CONTROLLER_MOTOR_TEST_DURATION_MS ?? "2000",
    10
  ),
  objectDetectionEnabled: process.env.OBJECT_DETECTION_ENABLED === "true",
  objectDetectionIntervalMs: Number.parseInt(
    process.env.OBJECT_DETECTION_INTERVAL_MS ?? "1000",
    10
  ),
  objectDetectionObjectType:
    process.env.OBJECT_DETECTION_OBJECT_TYPE?.trim() || "car",
  cameraStreamEnabled: process.env.CAMERA_STREAM_ENABLED !== "false",
  cameraStreamPublishUrl: process.env.CAMERA_STREAM_PUBLISH_URL?.trim() || "",
  cameraStreamExecutable: process.env.CAMERA_STREAM_EXECUTABLE?.trim() || "rpicam-vid",
  cameraStreamFfmpeg: process.env.CAMERA_STREAM_FFMPEG?.trim() || "ffmpeg",
  cameraStreamWidth: Number.parseInt(process.env.CAMERA_STREAM_WIDTH ?? "1280", 10),
  cameraStreamHeight: Number.parseInt(process.env.CAMERA_STREAM_HEIGHT ?? "720", 10),
  cameraStreamFps: Number.parseInt(process.env.CAMERA_STREAM_FPS ?? "20", 10),
  cameraStreamBitrate: Number.parseInt(
    process.env.CAMERA_STREAM_BITRATE ?? "2500000",
    10
  ),
  healthIntervalMs
};

if (!config.messageToken) {
  throw new Error("MESSAGE_TOKEN is required");
}
if (
  !Number.isFinite(config.objectDetectionIntervalMs) ||
  config.objectDetectionIntervalMs < 250
) {
  throw new Error("OBJECT_DETECTION_INTERVAL_MS must be at least 250");
}
if (config.cameraStreamEnabled && !/^rtsp:\/\/[^'"\s]+$/.test(config.cameraStreamPublishUrl)) {
  throw new Error("CAMERA_STREAM_PUBLISH_URL must be a valid RTSP URL");
}
if (
  !Number.isInteger(config.cameraStreamWidth) ||
  !Number.isInteger(config.cameraStreamHeight) ||
  config.cameraStreamWidth < 320 ||
  config.cameraStreamHeight < 240 ||
  !Number.isInteger(config.cameraStreamFps) ||
  config.cameraStreamFps < 1 ||
  config.cameraStreamFps > 60 ||
  !Number.isInteger(config.cameraStreamBitrate) ||
  config.cameraStreamBitrate < 100_000
) {
  throw new Error("Invalid camera stream dimensions, frame rate, or bitrate");
}
