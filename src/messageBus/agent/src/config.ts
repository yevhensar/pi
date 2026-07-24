import os from "node:os";
import { fileURLToPath } from "node:url";

const healthIntervalMs = Number.parseInt(process.env.HEALTH_INTERVAL_MS ?? "60000", 10);
if (!Number.isFinite(healthIntervalMs) || healthIntervalMs < 1000) {
  throw new Error("HEALTH_INTERVAL_MS must be a number of at least 1000");
}

export const config = {
  serverUrl: process.env.SERVER_URL ?? "http://127.0.0.1:3000",
  deviceId: process.env.DEVICE_ID?.trim() || os.hostname(),
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
  healthIntervalMs
};
