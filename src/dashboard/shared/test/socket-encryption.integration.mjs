import assert from "node:assert/strict";
import { io } from "socket.io-client";
import {
  createMessageCipher,
  messageContexts
} from "../dist/types.js";

const serverUrl = process.env.TEST_SERVER_URL ?? "http://127.0.0.1:34567";
const token = process.env.MESSAGE_TOKEN;
if (!token) throw new Error("MESSAGE_TOKEN is required");

const cipher = await createMessageCipher(token);
const socket = io(serverUrl, {
  autoConnect: false,
  transports: ["websocket"]
});

function encryptedEvent(event, context) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5_000);
    socket.once(event, async (message) => {
      clearTimeout(timer);
      try {
        resolve(await cipher.decrypt(context, message));
      } catch (error) {
        reject(error);
      }
    });
  });
}

socket.on("agent:command", async (message, acknowledge) => {
  const command = await cipher.decrypt(messageContexts.agentCommand, message);
  const timestamp = new Date().toISOString();
  acknowledge(await cipher.encrypt(messageContexts.agentCommandResult, {
    ...command,
    deviceId: "encrypted-test",
    success: true,
    output: "encrypted command response",
    startedAt: timestamp,
    completedAt: timestamp
  }));
});

const snapshotPromise = encryptedEvent(
  "devices:snapshot",
  messageContexts.deviceSnapshot
);
const updatePromise = encryptedEvent("device:updated", messageContexts.deviceUpdate);
socket.connect();
await new Promise((resolve, reject) => {
  socket.once("connect", resolve);
  socket.once("connect_error", reject);
});

const snapshot = await snapshotPromise;
assert.ok(Array.isArray(snapshot));

const timestamp = new Date().toISOString();
const encryptedHealth = await cipher.encrypt(messageContexts.health, {
  deviceId: "encrypted-test",
  hostname: "encrypted-test",
  timestamp,
  uptimeSeconds: 1,
  loadAverage: [0, 0, 0],
  totalMemoryBytes: 1024,
  freeMemoryBytes: 512,
  platform: "linux",
  architecture: "arm64",
  appVersion: "test",
  ipAddresses: ["127.0.0.1"]
});
const healthAcknowledgement = await new Promise((resolve, reject) => {
  socket.timeout(5_000).emit("device:health", encryptedHealth, async (error, message) => {
    if (error) {
      reject(error);
      return;
    }
    try {
      resolve(await cipher.decrypt(messageContexts.healthAcknowledgement, message));
    } catch (decryptionError) {
      reject(decryptionError);
    }
  });
});
assert.equal(healthAcknowledgement.success, true);
assert.equal((await updatePromise).health.deviceId, "encrypted-test");

const commandResult = await new Promise(async (resolve, reject) => {
  const command = await cipher.encrypt(messageContexts.browserCommand, {
    requestId: crypto.randomUUID(),
    deviceId: "encrypted-test",
    command: "system.info"
  });
  socket.timeout(5_000).emit("device:command", command, async (error, message) => {
    if (error) {
      reject(error);
      return;
    }
    try {
      resolve(await cipher.decrypt(messageContexts.browserCommandResult, message));
    } catch (decryptionError) {
      reject(decryptionError);
    }
  });
});
assert.equal(commandResult.success, true);
assert.equal(commandResult.output, "encrypted command response");

socket.disconnect();
console.log("Encrypted Socket.IO health and command round trip passed.");
