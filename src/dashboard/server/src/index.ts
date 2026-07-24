import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  DeviceCommandName,
  DeviceCommandRequest,
  DeviceCommandResult,
  EncryptedEnvelope,
  HealthAcknowledgement,
  HealthCheck,
  ServerToSocketEvents
} from "@pi-health/shared";
import { createMessageCipher, deviceCommandNames, messageContexts } from "@pi-health/shared";
import { config } from "./config.js";
import { DeviceStore } from "./device-store.js";

const app = express();
const httpServer = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToSocketEvents>(httpServer, {
  cors: { origin: true, credentials: true }
});
const cipher = await createMessageCipher(config.messageToken);
const devices = new DeviceStore();

app.disable("x-powered-by");
app.use(express.json());

app.get("/api/health", async (_request, response) => {
  response.json(await cipher.encrypt(messageContexts.apiHealth, {
    status: "ok",
    timestamp: new Date().toISOString(),
    connectedDevices: devices.connectedCount()
  }));
});

app.get("/api/devices", async (_request, response) => {
  response.json(await cipher.encrypt(messageContexts.apiDevices, devices.all()));
});

app.get("/api/devices/:deviceId", async (request, response) => {
  const device = devices.get(request.params.deviceId);
  if (!device) {
    response.status(404).json(
      await cipher.encrypt(messageContexts.apiDevice, { error: "Device not found" })
    );
    return;
  }
  response.json(await cipher.encrypt(messageContexts.apiDevice, device));
});

function isHealthCheck(value: unknown): value is HealthCheck {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return (
    typeof health.deviceId === "string" &&
    health.deviceId.trim().length > 0 &&
    typeof health.hostname === "string" &&
    typeof health.timestamp === "string" &&
    typeof health.uptimeSeconds === "number" &&
    Array.isArray(health.loadAverage) &&
    health.loadAverage.every((item) => typeof item === "number") &&
    typeof health.totalMemoryBytes === "number" &&
    typeof health.freeMemoryBytes === "number" &&
    typeof health.platform === "string" &&
    typeof health.architecture === "string" &&
    typeof health.appVersion === "string" &&
    Array.isArray(health.ipAddresses) &&
    health.ipAddresses.every((item) => typeof item === "string")
  );
}

function isCommandRequest(value: unknown): value is DeviceCommandRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Record<string, unknown>;
  return (
    typeof request.requestId === "string" &&
    request.requestId.length > 0 &&
    request.requestId.length <= 100 &&
    typeof request.deviceId === "string" &&
    request.deviceId.length > 0 &&
    typeof request.command === "string" &&
    deviceCommandNames.includes(request.command as DeviceCommandName)
  );
}

function commandError(
  request: Partial<DeviceCommandRequest>,
  error: string
): DeviceCommandResult {
  const timestamp = new Date().toISOString();
  return {
    requestId: request.requestId ?? "invalid",
    deviceId: request.deviceId ?? "",
    command: request.command ?? "system.info",
    success: false,
    output: "",
    startedAt: timestamp,
    completedAt: timestamp,
    error
  };
}

io.on("connection", (socket) => {
  void cipher.encrypt(messageContexts.deviceSnapshot, devices.all())
    .then((message) => socket.emit("devices:snapshot", message))
    .catch((error) => console.error("[crypto] could not encrypt device snapshot", error));

  socket.on("device:health", async (message, acknowledge) => {
    const receivedAt = new Date().toISOString();
    const reply = async (result: HealthAcknowledgement) => {
      if (typeof acknowledge === "function") {
        acknowledge(await cipher.encrypt(messageContexts.healthAcknowledgement, result));
      }
    };

    let health: HealthCheck;
    try {
      health = await cipher.decrypt<HealthCheck>(messageContexts.health, message);
    } catch (error) {
      console.warn(
        `[crypto] rejected health message from ${socket.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      await reply({ success: false, receivedAt, error: "Encrypted health message rejected" });
      return;
    }
    if (!isHealthCheck(health)) {
      await reply({ success: false, receivedAt, error: "Invalid health-check payload" });
      return;
    }

    const state = devices.update(socket.id, health, receivedAt);
    io.emit(
      "device:updated",
      await cipher.encrypt(messageContexts.deviceUpdate, state)
    );
    await reply({ success: true, receivedAt });
    console.log(`[health] ${health.deviceId} received at ${receivedAt}`);
  });

  socket.on("device:command", async (message, acknowledge) => {
    const reply = async (result: DeviceCommandResult) => {
      if (typeof acknowledge === "function") {
        acknowledge(await cipher.encrypt(messageContexts.browserCommandResult, result));
      }
    };

    let request: DeviceCommandRequest;
    try {
      request = await cipher.decrypt<DeviceCommandRequest>(
        messageContexts.browserCommand,
        message
      );
    } catch (error) {
      console.warn(
        `[crypto] rejected browser command from ${socket.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`
      );
      await reply(commandError({}, "Encrypted command rejected"));
      return;
    }
    if (!isCommandRequest(request)) {
      await reply(commandError({}, "Invalid command request"));
      return;
    }

    const targetSocketId = devices.socketIdFor(request.deviceId);
    if (!targetSocketId) {
      await reply(commandError(request, "Device is offline"));
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      await reply(commandError(request, "Device connection is unavailable"));
      return;
    }

    console.log(`[command] ${request.command} → ${request.deviceId}`);
    const encryptedCommand = await cipher.encrypt(messageContexts.agentCommand, {
      requestId: request.requestId,
      command: request.command
    });
    targetSocket.timeout(15_000).emit(
      "agent:command",
      encryptedCommand,
      async (error: Error | null, message?: EncryptedEnvelope) => {
        if (error || !message) {
          await reply(commandError(request, "Device command timed out"));
          return;
        }
        try {
          const result = await cipher.decrypt<DeviceCommandResult>(
            messageContexts.agentCommandResult,
            message
          );
          await reply(result);
        } catch {
          await reply(commandError(request, "Encrypted device response rejected"));
        }
      }
    );
  });

  socket.on("disconnect", (reason) => {
    for (const state of devices.disconnect(socket.id)) {
      void cipher.encrypt(messageContexts.deviceUpdate, state)
        .then((message) => io.emit("device:updated", message))
        .catch((error) => console.error("[crypto] could not encrypt device update", error));
      console.log(`[disconnect] ${state.health.deviceId}: ${reason}`);
    }
  });
});

if (fs.existsSync(config.webDistPath)) {
  app.use(express.static(config.webDistPath));
  app.get(/^(?!\/api|\/socket\.io).*/, (_request, response) => {
    response.sendFile(path.join(config.webDistPath, "index.html"));
  });
} else {
  app.get("/", (_request, response) => {
    response.status(503).send("Web application has not been built. Run npm run build.");
  });
}

httpServer.listen(config.port, config.host, () => {
  console.log(`Pi Health Monitor listening on http://${config.host}:${config.port}`);
});

function shutdown(signal: string) {
  console.log(`${signal} received; shutting down`);
  io.close();
  httpServer.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
