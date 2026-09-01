import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const PREFIX = "enc:v1";

function encryptionKey(): Buffer {
  const raw = process.env.MT5_CREDENTIAL_KEY;
  if (!raw) throw new Error("MT5_CREDENTIAL_KEY must be configured before storing MT5 credentials");

  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("MT5_CREDENTIAL_KEY must be a 32-byte base64 or 64-character hex key");
  return key;
}

export function encryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(`${PREFIX}:`)) {
    throw new Error("Legacy plaintext MT5 credential detected; re-enter the account password to encrypt it");
  }
  const [, , ivRaw, tagRaw, ciphertextRaw] = value.split(":");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextRaw, "base64")), decipher.final()]).toString("utf8");
}
