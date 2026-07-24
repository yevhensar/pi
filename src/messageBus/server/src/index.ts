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
  HealthAcknowledgement,
  HealthCheck,
  ServerToSocketEvents
} from "@pi-health/shared";
import { deviceCommandNames } from "@pi-health/shared";
import { config } from "./config.js";
import { DeviceStore } from "./device-store.js";

const app = express();
const httpServer = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToSocketEvents>(httpServer, {
  cors: { origin: true, credentials: true }
});
const devices = new DeviceStore();

app.disable("x-powered-by");
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    connectedDevices: devices.connectedCount()
  });
});

app.get("/api/devices", (_request, response) => {
  response.json(devices.all());
});

app.get("/api/devices/:deviceId", (request, response) => {
  const device = devices.get(request.params.deviceId);
  if (!device) {
    response.status(404).json({ error: "Device not found" });
    return;
  }
  response.json(device);
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
  socket.emit("devices:snapshot", devices.all());

  socket.on("device:health", (health, acknowledge) => {
    const receivedAt = new Date().toISOString();
    const reply = (result: HealthAcknowledgement) => {
      if (typeof acknowledge === "function") acknowledge(result);
    };

    if (!isHealthCheck(health)) {
      reply({ success: false, receivedAt, error: "Invalid health-check payload" });
      return;
    }

    const state = devices.update(socket.id, health, receivedAt);
    io.emit("device:updated", state);
    reply({ success: true, receivedAt });
    console.log(`[health] ${health.deviceId} received at ${receivedAt}`);
  });

  socket.on("device:command", (request, acknowledge) => {
    const reply = (result: DeviceCommandResult) => {
      if (typeof acknowledge === "function") acknowledge(result);
    };

    if (!isCommandRequest(request)) {
      reply(commandError({}, "Invalid command request"));
      return;
    }

    const targetSocketId = devices.socketIdFor(request.deviceId);
    if (!targetSocketId) {
      reply(commandError(request, "Device is offline"));
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetSocketId);
    if (!targetSocket) {
      reply(commandError(request, "Device connection is unavailable"));
      return;
    }

    console.log(`[command] ${request.command} → ${request.deviceId}`);
    targetSocket.timeout(15_000).emit(
      "agent:command",
      { requestId: request.requestId, command: request.command },
      (error: Error | null, result?: DeviceCommandResult) => {
        if (error || !result) {
          reply(commandError(request, "Device command timed out"));
          return;
        }
        reply(result);
      }
    );
  });

  socket.on("disconnect", (reason) => {
    for (const state of devices.disconnect(socket.id)) {
      io.emit("device:updated", state);
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
