#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let tokenFile = path.join(rootDirectory, "config", "message-token.json");
let mode = "init";
let quiet = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--init") mode = "init";
  else if (argument === "--regenerate") mode = "regenerate";
  else if (argument === "--show") mode = "show";
  else if (argument === "--quiet") quiet = true;
  else if (argument === "--file") {
    const fileArgument = process.argv[index + 1];
    if (!fileArgument) throw new Error("--file requires a path");
    tokenFile = path.resolve(fileArgument);
    index += 1;
  } else {
    throw new Error(`Unknown option: ${argument}`);
  }
}

function readToken() {
  const parsed = JSON.parse(fs.readFileSync(tokenFile, "utf8"));
  const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new Error(`${tokenFile} must contain a 32-byte base64url token`);
  }
  return token;
}

function tokenDocument() {
  return `${JSON.stringify({ token: randomBytes(32).toString("base64url") }, null, 2)}\n`;
}

function createToken() {
  const directory = path.dirname(tokenFile);
  fs.mkdirSync(directory, { recursive: true });
  try {
    fs.writeFileSync(tokenFile, tokenDocument(), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  fs.chmodSync(tokenFile, 0o600);
  return readToken();
}

function regenerateToken() {
  const directory = path.dirname(tokenFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = `${tokenFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryFile, tokenDocument(), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryFile, tokenFile);
  fs.chmodSync(tokenFile, 0o600);
  return readToken();
}

if (mode === "show") {
  console.log(readToken());
} else if (mode === "regenerate") {
  regenerateToken();
  if (!quiet) {
    console.log(`Regenerated message token in ${tokenFile}`);
    console.log("Redeploy the local server and every Pi client before using the new token.");
  }
} else if (fs.existsSync(tokenFile)) {
  readToken();
  fs.chmodSync(tokenFile, 0o600);
  if (!quiet) console.log(`Using existing message token in ${tokenFile}`);
} else {
  createToken();
  if (!quiet) console.log(`Created message token in ${tokenFile}`);
}
