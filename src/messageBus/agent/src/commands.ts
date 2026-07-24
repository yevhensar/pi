import { execFile } from "node:child_process";
import type {
  DeviceCommand,
  DeviceCommandName,
  DeviceCommandResult
} from "@pi-health/shared";

type CommandDefinition = {
  executable: string;
  arguments: string[];
};

const commands: Record<DeviceCommandName, CommandDefinition> = {
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
