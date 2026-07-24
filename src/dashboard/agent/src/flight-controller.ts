import { execFile } from "node:child_process";
import type { FlightControllerHealth } from "@pi-health/shared";
import { config } from "./config.js";
import { withFlightControllerSerial } from "./flight-controller-lock.js";

function unavailable(error: string): FlightControllerHealth {
  return {
    status: "disconnected",
    checkedAt: new Date().toISOString(),
    vehicleConnected: false,
    preArmFailures: [],
    error
  };
}

export function collectFlightControllerHealth(): Promise<FlightControllerHealth> {
  if (!config.flightControllerEnabled) {
    return Promise.resolve(unavailable("Flight-controller monitoring is disabled"));
  }

  return withFlightControllerSerial(() => new Promise((resolve) => {
    execFile(
      config.flightControllerPython,
      [
        config.flightControllerScript,
        "--device",
        config.flightControllerDevice,
        "--protocol",
        config.flightControllerProtocol,
        "--baud",
        String(config.flightControllerBaud),
        "--timeout",
        String(config.flightControllerTimeoutMs / 1000)
      ],
      {
        timeout: config.flightControllerTimeoutMs + 3_000,
        maxBuffer: 256 * 1024,
        encoding: "utf8"
      },
      (error, stdout, stderr) => {
        try {
          const parsed = JSON.parse(stdout.trim()) as FlightControllerHealth;
          parsed.motorTestEnabled =
            config.motorTestEnabled && parsed.protocol === "msp";
          resolve(parsed);
        } catch {
          resolve(
            unavailable(
              stderr.trim() || error?.message || "Flight-controller probe returned invalid data"
            )
          );
        }
      }
    );
  }));
}
