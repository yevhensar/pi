import { io, type Socket } from "socket.io-client";
import type {
  AgentToServerEvents,
  HealthAcknowledgement,
  ServerToClientEvents
} from "@pi-health/shared";
import { config } from "./config.js";
import { collectHealth } from "./health.js";

const APP_VERSION = "1.0.0";
const socket: Socket<ServerToClientEvents, AgentToServerEvents> = io(config.serverUrl, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1_000,
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
  transports: ["websocket", "polling"]
});

let interval: NodeJS.Timeout | undefined;

function transmit() {
  const health = collectHealth(config.deviceId, APP_VERSION, config.wifiInterface);
  console.log(`[health] sending ${health.deviceId} at ${health.timestamp}`);
  socket.timeout(10_000).emit(
    "device:health",
    health,
    (error: Error | null, result?: HealthAcknowledgement) => {
      if (error) {
        console.error("[health] acknowledgement timed out", error.message);
        return;
      }
      if (result?.success) {
        console.log(`[health] acknowledged at ${result.receivedAt}`);
      } else {
        console.error(`[health] rejected: ${result?.error ?? "unknown error"}`);
      }
    }
  );
}

socket.on("connect", () => {
  console.log(`[socket] connected to ${config.serverUrl} as ${socket.id}`);
  if (interval) clearInterval(interval);
  transmit();
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

function shutdown(signal: string) {
  console.log(`[agent] ${signal} received; shutting down`);
  if (interval) clearInterval(interval);
  socket.close();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
