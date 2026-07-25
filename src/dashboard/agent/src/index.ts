import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  DeviceCommand,
  DeviceCommandResult,
  DetectionFrameAcknowledgement,
  EncryptedEnvelope,
  HealthAcknowledgement,
  ServerToSocketEvents
} from "@pi-health/shared";
import { createMessageCipher, messageContexts } from "@pi-health/shared";
import { config } from "./config.js";
import { executeCommand } from "./commands.js";
import { collectFlightControllerHealth } from "./flight-controller.js";
import { collectHealth } from "./health.js";
import { captureCameraPhoto } from "./camera.js";
import {
  detectionFramesPaused,
  pauseDetectionFrames
} from "./detection-control.js";

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
let detectionTimer: NodeJS.Timeout | undefined;
let detectionStopped = true;

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

async function transmitDetectionFrame() {
  if (
    detectionStopped ||
    !config.objectDetectionEnabled ||
    !socket.connected
  ) return;
  if (detectionFramesPaused()) {
    detectionTimer = setTimeout(() => void transmitDetectionFrame(), 500);
    return;
  }
  const started = Date.now();
  try {
    const capture = await captureCameraPhoto("detection");
    const encryptedFrame = await cipher.encrypt(messageContexts.detectionFrame, {
      ...capture,
      deviceId: config.deviceId,
      objectType: config.objectDetectionObjectType
    });
    await new Promise<void>((resolve, reject) => {
      socket.timeout(30_000).emit(
        "device:detection-frame",
        encryptedFrame,
        async (error: Error | null, message?: EncryptedEnvelope) => {
          if (error || !message) {
            reject(error ?? new Error("Detection server did not acknowledge the frame"));
            return;
          }
          try {
            const result = await cipher.decrypt<DetectionFrameAcknowledgement>(
              messageContexts.detectionFrameAcknowledgement,
              message
            );
            if (result.pause) pauseDetectionFrames();
            result.success ? resolve() : reject(new Error(result.error ?? "Detection failed"));
          } catch (failure) {
            reject(failure);
          }
        }
      );
    });
  } catch (error) {
    console.error(
      `[object-detection] ${error instanceof Error ? error.message : "frame failed"}`
    );
  } finally {
    if (!detectionStopped) {
      const delay = Math.max(0, config.objectDetectionIntervalMs - (Date.now() - started));
      detectionTimer = setTimeout(() => void transmitDetectionFrame(), delay);
    }
  }
}

socket.on("connect", () => {
  console.log(`[socket] connected to ${config.serverUrl} as ${socket.id}`);
  if (interval) clearInterval(interval);
  void transmit();
  interval = setInterval(transmit, config.healthIntervalMs);
  detectionStopped = false;
  if (detectionTimer) clearTimeout(detectionTimer);
  if (config.objectDetectionEnabled) void transmitDetectionFrame();
});

socket.on("disconnect", (reason) => {
  console.warn(`[socket] disconnected: ${reason}`);
  if (interval) clearInterval(interval);
  interval = undefined;
  detectionStopped = true;
  if (detectionTimer) clearTimeout(detectionTimer);
  detectionTimer = undefined;
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
  detectionStopped = true;
  if (detectionTimer) clearTimeout(detectionTimer);
  socket.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
