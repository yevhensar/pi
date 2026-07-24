import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createMessageCipher } from "../dist/types.js";

function token() {
  return randomBytes(32).toString("base64url");
}

test("round trips an authenticated encrypted payload", async () => {
  const cipher = await createMessageCipher(token());
  const envelope = await cipher.encrypt("health", { deviceId: "pipa1", healthy: true });

  assert.deepEqual(
    await cipher.decrypt("health", envelope),
    { deviceId: "pipa1", healthy: true }
  );
  assert.equal(JSON.stringify(envelope).includes("pipa1"), false);
});

test("rejects the wrong context, token, tampering, and replay", async () => {
  const first = await createMessageCipher(token());
  const second = await createMessageCipher(token());

  const wrongContext = await first.encrypt("health", { ok: true });
  await assert.rejects(first.decrypt("command", wrongContext), /authenticate or decrypt/);

  const wrongToken = await first.encrypt("health", { ok: true });
  await assert.rejects(second.decrypt("health", wrongToken), /authenticate or decrypt/);

  const tampered = await first.encrypt("health", { ok: true });
  const replacement = tampered.ciphertext.endsWith("A") ? "B" : "A";
  tampered.ciphertext = `${tampered.ciphertext.slice(0, -1)}${replacement}`;
  await assert.rejects(first.decrypt("health", tampered), /authenticate or decrypt/);

  const replay = await first.encrypt("health", { ok: true });
  assert.deepEqual(await first.decrypt("health", replay), { ok: true });
  await assert.rejects(first.decrypt("health", replay), /replay rejected/);
});
