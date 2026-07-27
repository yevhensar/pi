import { useState } from "react";
import type {
  DeviceCommandName,
  DeviceCommandResult,
  EncryptedEnvelope,
  MessageCipher
} from "@pi-health/shared";
import { messageContexts } from "@pi-health/shared";
import { socket } from "../socket";
import type { DeviceState, DeviceStatus } from "../types";

export const commandOptions: {
  command: DeviceCommandName;
  label: string;
  description: string;
  kind?: "motor-start" | "motor-stop";
}[] = [
  { command: "system.info", label: "System info", description: "Kernel, OS, and architecture" },
  { command: "disk.usage", label: "Disk usage", description: "Mounted filesystem capacity" },
  { command: "network.interfaces", label: "Network", description: "Interface and address status" },
  { command: "processes.top", label: "Top processes", description: "Processes ranked by CPU use" },
  {
    command: "flight-controller.motor-test.start",
    label: "Start motor test",
    description: "Fixed low output with an automatic 3-second maximum cutoff",
    kind: "motor-start"
  },
  {
    command: "flight-controller.motor-test.stop",
    label: "Stop motor test",
    description: "Reset all detected Betaflight motor-test outputs to minimum",
    kind: "motor-stop"
  }
];

export function useRemoteDiagnostics(device: DeviceState | undefined, cipher: MessageCipher) {
  const [pending, setPending] = useState<DeviceCommandName | null>(null);
  const [results, setResults] = useState<DeviceCommandResult[]>([]);

  async function runCommand(command: DeviceCommandName) {
    if (!device || pending) return;
    if (
      command === "flight-controller.motor-test.start" &&
      !window.confirm(
        "Remove all propellers and clear the area before continuing.\n\n" +
        "This will command every detected motor at low output. The Pi will " +
        "automatically return output to minimum after the configured duration.\n\n" +
        "Continue with the motor test?"
      )
    ) {
      return;
    }

    setPending(command);
    const requestId = crypto.randomUUID();
    const encryptedRequest = await cipher.encrypt(messageContexts.browserCommand, {
      requestId,
      deviceId: device.health.deviceId,
      command
    });
    socket.timeout(17_000).emit(
      "device:command",
      encryptedRequest,
      async (error: Error | null, message?: EncryptedEnvelope) => {
        setPending(null);
        const timestamp = new Date().toISOString();
        let result: DeviceCommandResult | undefined;
        let decryptionError: string | undefined;
        try {
          if (message) {
            result = await cipher.decrypt<DeviceCommandResult>(
              messageContexts.browserCommandResult,
              message
            );
          }
        } catch (failure) {
          decryptionError =
            failure instanceof Error ? failure.message : "Encrypted response rejected";
        }
        const completed: DeviceCommandResult = result ?? {
          requestId,
          deviceId: device.health.deviceId,
          command,
          success: false,
          output: "",
          startedAt: timestamp,
          completedAt: timestamp,
          error: decryptionError ?? error?.message ?? "Server did not answer"
        };
        setResults((current) => [completed, ...current].slice(0, 10));
      }
    );
  }

  return {
    clearResults: () => setResults([]),
    pending,
    results,
    runCommand
  };
}

export function RemoteDiagnostics({
  device,
  pending,
  runCommand,
  status
}: {
  device: DeviceState;
  pending: DeviceCommandName | null;
  runCommand: (command: DeviceCommandName) => Promise<void>;
  status: DeviceStatus;
}) {
  const controller = device.health.flightController;
  const motorStartReady =
    status !== "offline" &&
    controller?.vehicleConnected === true &&
    controller.protocol === "msp" &&
    controller.armed === false &&
    controller.motorTestEnabled === true;
  const motorStopReady =
    status !== "offline" &&
    controller?.vehicleConnected === true &&
    controller.protocol === "msp" &&
    controller.armed === false;

  return (
    <section className="detail-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Remote diagnostics</p>
          <h2>Send a command</h2>
        </div>
        <span>Allowlisted</span>
      </div>
      <p className="panel-copy">
        Commands run on this Pi through its agent and return their output here.
      </p>
      {controller?.protocol === "msp" && !motorStartReady && (
        <div className="motor-lock">
          <strong>Motor test locked</strong>
          <span>
            {controller.armed
              ? "Disarm the flight controller before testing."
              : controller.motorTestEnabled !== true
              ? "Enable flight_controller.motor_test in the client config, then redeploy."
              : "The Betaflight connection must be online and report a disarmed state."}
          </span>
        </div>
      )}
      <div className="command-grid">
        {commandOptions.map((option) => {
          const motorDisabled =
            option.kind === "motor-start"
              ? !motorStartReady
              : option.kind === "motor-stop"
              ? !motorStopReady
              : false;
          return (
            <button
              className={option.kind ?? ""}
              key={option.command}
              disabled={status === "offline" || pending !== null || motorDisabled}
              onClick={() => void runCommand(option.command)}
            >
              <span>{pending === option.command ? "Running…" : option.label}</span>
              <small>{option.description}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
