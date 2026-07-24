import os from "node:os";
import type { HealthCheck } from "@pi-health/shared";

function ipAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => !address.internal)
    .map((address) => address.address);
}

export function collectHealth(deviceId: string, appVersion: string): HealthCheck {
  return {
    deviceId,
    hostname: os.hostname(),
    timestamp: new Date().toISOString(),
    uptimeSeconds: os.uptime(),
    loadAverage: os.loadavg(),
    totalMemoryBytes: os.totalmem(),
    freeMemoryBytes: os.freemem(),
    platform: os.platform(),
    architecture: os.arch(),
    appVersion,
    ipAddresses: ipAddresses()
  };
}
