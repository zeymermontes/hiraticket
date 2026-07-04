import "server-only"; // hard build error if a client component ever imports this (the key must never ship to the browser)
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// Server-only symmetric encryption for plugin credentials (API keys, tokens). We never store these
// in plaintext and never send the decrypted value to the client (see MASK below).
//
// Key: derived from PLUGIN_SECRET_KEY if set, else from the service-role key (always present
// server-side) so it works out of the box. Rotating that key invalidates existing ciphertexts —
// set a stable PLUGIN_SECRET_KEY in prod.

const PREFIX = "enc:v1:";
export const MASK = "••••••••";

function key(): Buffer {
  const secret = process.env.PLUGIN_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "hiraticket-dev-key";
  return scryptSync(secret, "hiraticket-plugins", 32);
}

export function isEncrypted(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a secret string → "enc:v1:<base64(iv|tag|cipher)>". Empty input passes through unchanged. */
export function encryptSecret(plain: string): string {
  if (!plain) return plain;
  if (isEncrypted(plain)) return plain; // already encrypted
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

/** Decrypt a value produced by encryptSecret. Non-encrypted values are returned as-is. */
export function decryptSecret(v: string): string {
  if (!isEncrypted(v)) return v;
  try {
    const raw = Buffer.from(v.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
