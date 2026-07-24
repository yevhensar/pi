import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DeviceCommand,
  DeviceCommandResult,
  EncryptedEnvelope,
  HealthAcknowledgement,
  ServerToSocketEvents
} from "@pi-health/shared";
import { createMessageCipher, messageContexts } from "@pi-health/shared";
import { config } from "./config.js";
import { executeCommand } from "./commands.js";
import { collectFlightControllerHealth } from "./flight-controller.js";
import { collectHealth } from "./health.js";

const APP_VERSION = "1.0.0";
const cipher = await createMessageCipher(config.messageToken);
const socket: Socket<ServerToSocketEvents, ClientToServerEvents> = io(config.serverUrl, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
  transports: ["websocket", "polling"]
});

let interval: NodeJS.Timeout | undefined;

let transmissionInProgress = false;

async function transmit() {
  if (transmissionInProgress) return;
  transmissionInProgress = true;
  const flightController = await collectFlightControllerHealth();
  const health = collectHealth(
    config.deviceId,
    APP_VERSION,
    config.wifiInterface,
    flightController
  );
  console.log(`[health] sending ${health.deviceId} at ${health.timestamp}`);
  const encryptedHealth = await cipher.encrypt(messageContexts.health, health);
  socket.timeout(10_000).emit(
    "device:health",
    encryptedHealth,
    async (error: Error | null, message?: EncryptedEnvelope) => {
      if (error) {
        console.error("[health] acknowledgement timed out", error.message);
        transmissionInProgress = false;
        return;
      }
      let result: HealthAcknowledgement | undefined;
      try {
        if (message) {
          result = await cipher.decrypt<HealthAcknowledgement>(
            messageContexts.healthAcknowledgement,
            message
          );
        }
      } catch (decryptionError) {
        console.error(
          "[health] encrypted acknowledgement rejected",
          decryptionError instanceof Error ? decryptionError.message : "unknown error"
        );
      }
      if (result?.success) {
        console.log(`[health] acknowledged at ${result.receivedAt}`);
      } else {
        console.error(`[health] rejected: ${result?.error ?? "unknown error"}`);
      }
      transmissionInProgress = false;
    }
  );
}

socket.on("connect", () => {
  console.log(`[socket] connected to ${config.serverUrl} as ${socket.id}`);
  if (interval) clearInterval(interval);
  void transmit();
  interval = setInterval(transmit, config.healthIntervalMs);
});

socket.on("disconnect", (reason) => {
  console.warn(`[socket] disconnected: ${reason}`);
  if (interval) clearInterval(interval);
  interval = undefined;
});

socket.on("connect_error", (error) => {
  console.error(`[socket] connection error: ${error.message}`);
});

socket.on("agent:command", async (command, acknowledge) => {
  let request: DeviceCommand;
  try {
    request = await cipher.decrypt<DeviceCommand>(messageContexts.agentCommand, command);
  } catch (error) {
    console.error(
      "[command] encrypted command rejected",
      error instanceof Error ? error.message : "unknown error"
    );
    return;
  }
  console.log(`[command] ${request.command} (${request.requestId})`);
  const result: DeviceCommandResult = await executeCommand(config.deviceId, request);
  acknowledge(await cipher.encrypt(messageContexts.agentCommandResult, result));
  console.log(`[command] ${request.command} ${result.success ? "completed" : "failed"}`);
});

function shutdown(signal: string) {
  console.log(`[agent] ${signal} received; shutting down`);
  if (interval) clearInterval(interval);
  socket.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
