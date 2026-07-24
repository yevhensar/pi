import os from "node:os";
import type { HealthCheck } from "@pi-health/shared";

function ipAddresses(interfaceName?: string): string[] {
  const interfaces = os.networkInterfaces();
  const selected = interfaceName ? [interfaces[interfaceName]] : Object.values(interfaces);
  return selected
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => !address.internal)
    .map((address) => address.address);
}

export function collectHealth(
  deviceId: string,
  appVersion: string,
  interfaceName?: string
): HealthCheck {
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
    ipAddresses: ipAddresses(interfaceName)
  };
}
