import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Server } from "socket.io";
import type {
  AgentToServerEvents,
  HealthAcknowledgement,
  HealthCheck,
  ServerToClientEvents
} from "@pi-health/shared";
import { config } from "./config.js";
import { DeviceStore } from "./device-store.js";

const app = express();
const httpServer = http.createServer(app);
const io = new Server<AgentToServerEvents, ServerToClientEvents>(httpServer, {
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
