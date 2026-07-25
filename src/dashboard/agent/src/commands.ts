import { execFile } from "node:child_process";
import type {
  DeviceCommand,
  DeviceCommandName,
  DeviceCommandResult
} from "@pi-health/shared";
import { config } from "./config.js";
import { cameraHealth, captureCameraPhoto } from "./camera.js";
import { tryWithFlightControllerSerial } from "./flight-controller-lock.js";

type CommandDefinition = {
  executable: string;
  arguments: string[];
};

const commands: Partial<Record<DeviceCommandName, CommandDefinition>> = {
  "system.info": {
    executable: "uname",
    arguments: ["-a"]
  },
  "disk.usage": {
    executable: "df",
    arguments: ["-h", "--output=source,size,used,avail,pcent,target"]
  },
  "network.interfaces": {
    executable: "ip",
    arguments: ["-brief", "address"]
  },
  "processes.top": {
    executable: "ps",
    arguments: ["-eo", "pid,comm,%cpu,%mem", "--sort=-%cpu"]
  }
};

function run(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { timeout: 10_000, maxBuffer: 256 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim().slice(0, 64_000));
      }
    );
  });
}

export async function executeCommand(
  deviceId: string,
  request: DeviceCommand
): Promise<DeviceCommandResult> {
  const startedAt = new Date().toISOString();
  const definition = commands[request.command];

  try {
    if (request.command === "camera.health") {
      return {
        ...request,
        deviceId,
        success: true,
        output: JSON.stringify(await cameraHealth()),
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (request.command === "camera.capture") {
      return {
        ...request,
        deviceId,
        success: true,
        output: JSON.stringify(await captureCameraPhoto()),
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (request.command === "camera.preview") {
      return {
        ...request,
        deviceId,
        success: true,
        output: JSON.stringify(await captureCameraPhoto("preview")),
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (request.command === "flight-controller.attitude") {
      const output = await tryWithFlightControllerSerial(() => run(config.flightControllerPython, [
        config.flightControllerScript,
        "--device",
        config.flightControllerDevice,
        "--protocol",
        "msp",
        "--baud",
        String(config.flightControllerBaud),
        "--timeout",
        String(config.flightControllerTimeoutMs / 1000),
        "--action",
        "attitude"
      ]));
      const response = JSON.parse(output) as { success: boolean; error?: string };
      if (!response.success) throw new Error(response.error ?? "Attitude sample failed");
      return {
        ...request,
        deviceId,
        success: true,
        output,
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (request.command === "flight-controller.motor-test.start") {
      if (!config.motorTestEnabled) {
        throw new Error("Motor test is disabled in the Pi deployment configuration");
      }
      const output = await tryWithFlightControllerSerial(() => run(config.flightControllerPython, [
        config.flightControllerScript,
        "--device",
        config.flightControllerDevice,
        "--protocol",
        config.flightControllerProtocol,
        "--baud",
        String(config.flightControllerBaud),
        "--timeout",
        String(config.flightControllerTimeoutMs / 1000),
        "--action",
        "motor-test-start",
        "--output",
        String(config.motorTestOutput),
        "--duration",
        String(config.motorTestDurationMs / 1000)
      ]));
      const response = JSON.parse(output) as { success: boolean; message?: string; error?: string };
      if (!response.success) throw new Error(response.error ?? "Motor test failed");
      return {
        ...request,
        deviceId,
        success: true,
        output: response.message ?? "Motor test completed and stopped",
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (request.command === "flight-controller.motor-test.stop") {
      const output = await tryWithFlightControllerSerial(() => run(config.flightControllerPython, [
        config.flightControllerScript,
        "--device",
        config.flightControllerDevice,
        "--protocol",
        config.flightControllerProtocol,
        "--baud",
        String(config.flightControllerBaud),
        "--timeout",
        String(config.flightControllerTimeoutMs / 1000),
        "--action",
        "motor-test-stop"
      ]));
      const response = JSON.parse(output) as { success: boolean; message?: string; error?: string };
      if (!response.success) throw new Error(response.error ?? "Stop command failed");
      return {
        ...request,
        deviceId,
        success: true,
        output: response.message ?? "Minimum motor output sent",
        startedAt,
        completedAt: new Date().toISOString()
      };
    }

    if (!definition) throw new Error("Unsupported command");
    const output = await run(definition.executable, definition.arguments);
    return {
      ...request,
      deviceId,
      success: true,
      output,
      startedAt,
      completedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      ...request,
      deviceId,
      success: false,
      output: "",
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Command failed"
    };
  }
}
