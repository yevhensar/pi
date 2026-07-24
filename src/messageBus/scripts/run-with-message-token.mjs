#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tokenScript = path.join(rootDirectory, "scripts", "message-token.mjs");
const tokenFile = path.join(rootDirectory, "config", "message-token.json");
const [command, ...argumentsList] = process.argv.slice(2);

if (!command) {
  throw new Error("Usage: run-with-message-token.mjs COMMAND [ARGUMENTS...]");
}

const initialization = spawnSync(
  process.execPath,
  [tokenScript, "--file", tokenFile, "--init", "--quiet"],
  { stdio: "inherit" }
);
if (initialization.status !== 0) {
  process.exit(initialization.status ?? 1);
}

const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
  throw new Error("Local message token is invalid");
}

const child = spawn(command, argumentsList, {
  cwd: rootDirectory,
  env: { ...process.env, MESSAGE_TOKEN: token },
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
