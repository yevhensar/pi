const TOKEN_BYTES = 32;
const NONCE_BYTES = 12;
const MAX_SEEN_MESSAGES = 10_000;

export const messageContexts = {
  health: "device:health",
  healthAcknowledgement: "device:health:acknowledgement",
  deviceSnapshot: "devices:snapshot",
  deviceUpdate: "device:updated",
  browserCommand: "device:command",
  browserCommandResult: "device:command:result",
  agentCommand: "agent:command",
  agentCommandResult: "agent:command:result",
  apiHealth: "api:health",
  apiDevices: "api:devices",
  apiDevice: "api:device"
} as const;

export type EncryptedEnvelope = {
  version: 1;
  nonce: string;
  ciphertext: string;
};

type EncryptedPayload<T> = {
  messageId: string;
  payload: T;
};

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Message token must use base64url characters");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error("Message token is not valid base64url");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.length);
  copy.set(value);
  return copy.buffer;
}

export class MessageCipher {
  readonly #key: CryptoKey;
  readonly #seen = new Set<string>();
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();

  constructor(key: CryptoKey) {
    this.#key = key;
  }

  async encrypt<T>(context: string, payload: T): Promise<EncryptedEnvelope> {
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
    const plaintext = this.#encoder.encode(JSON.stringify({
      messageId: crypto.randomUUID(),
      payload
    } satisfies EncryptedPayload<T>));
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: nonce,
        additionalData: this.#encoder.encode(context),
        tagLength: 128
      },
      this.#key,
      plaintext
    );
    return {
      version: 1,
      nonce: encodeBase64Url(nonce),
      ciphertext: encodeBase64Url(new Uint8Array(ciphertext))
    };
  }

  async decrypt<T>(context: string, envelope: EncryptedEnvelope): Promise<T> {
    if (
      !envelope ||
      envelope.version !== 1 ||
      typeof envelope.nonce !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error("Invalid encrypted message envelope");
    }

    try {
      const nonce = decodeBase64Url(envelope.nonce);
      if (nonce.length !== NONCE_BYTES) throw new Error("Invalid nonce");
      const plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toArrayBuffer(nonce),
          additionalData: this.#encoder.encode(context),
          tagLength: 128
        },
        this.#key,
        toArrayBuffer(decodeBase64Url(envelope.ciphertext))
      );
      const decoded = JSON.parse(this.#decoder.decode(plaintext)) as EncryptedPayload<T>;
      if (!decoded || typeof decoded.messageId !== "string" || !("payload" in decoded)) {
        throw new Error("Invalid encrypted payload");
      }
      if (this.#seen.has(decoded.messageId)) {
        throw new Error("Encrypted message replay rejected");
      }
      this.#seen.add(decoded.messageId);
      if (this.#seen.size > MAX_SEEN_MESSAGES) {
        const oldest = this.#seen.values().next().value;
        if (oldest) this.#seen.delete(oldest);
      }
      return decoded.payload;
    } catch (error) {
      if (error instanceof Error && error.message === "Encrypted message replay rejected") {
        throw error;
      }
      throw new Error("Could not authenticate or decrypt message");
    }
  }
}

export async function createMessageCipher(token: string): Promise<MessageCipher> {
  const keyBytes = decodeBase64Url(token.trim());
  if (keyBytes.length !== TOKEN_BYTES) {
    throw new Error("Message token must decode to exactly 32 bytes");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return new MessageCipher(key);
}
