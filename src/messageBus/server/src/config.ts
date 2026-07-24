import path from "node:path";
import { fileURLToPath } from "node:url";

const serverDirectory = path.dirname(fileURLToPath(import.meta.url));

export const config = {
  host: "0.0.0.0",
  port: Number.parseInt(process.env.PORT ?? "3000", 10),
  webDistPath: path.resolve(serverDirectory, "../../web/dist")
};

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}
