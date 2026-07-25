import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  host: "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  messageToken: process.env.MESSAGE_TOKEN?.trim() || "",
  objectDetectionApiUrl:
    process.env.OBJECT_DETECTION_API_URL?.trim() ||
    "http://127.0.0.1:8000/api/detect",
  objectDetectionTimeoutMs: Number.parseInt(
    process.env.OBJECT_DETECTION_TIMEOUT_MS ?? "30000",
    10
  ),
  webDistPath: path.resolve(serverDirectory, "../../web/dist")
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
if (!config.messageToken) {
  throw new Error("MESSAGE_TOKEN is required");
}
