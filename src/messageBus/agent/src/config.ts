import os from "node:os";

const healthIntervalMs = Number.parseInt(process.env.HEALTH_INTERVAL_MS ?? "60000", 10);
if (!Number.isFinite(healthIntervalMs) || healthIntervalMs < 1000) {
  throw new Error("HEALTH_INTERVAL_MS must be a number of at least 1000");
}

export const config = {
  serverUrl: process.env.SERVER_URL ?? "http://127.0.0.1:3000",
  deviceId: process.env.DEVICE_ID?.trim() || os.hostname(),
  wifiInterface: process.env.WIFI_INTERFACE?.trim() || undefined,
  healthIntervalMs
};
