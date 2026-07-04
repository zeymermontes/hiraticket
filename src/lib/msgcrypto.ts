import "server-only"; // hard build error if a client component ever imports this (the key must never ship to the browser)
import { createCipheriv, createDecipheriv, randomBytes, hkdfSync } from "node:crypto";

// Server-only at-rest encryption for chat message bodies (`messages.body`, `internal_messages.body`).
// AES-256-GCM with a per-tenant subkey: HKDF-SHA256(MESSAGE_SECRET_KEY, info=businessId), so one
// tenant's ciphertexts are useless for another even with DB access.
//
// This is application-level at-rest encryption (defends a stolen DB dump / direct DB access), NOT
// end-to-end: the web server and the Go worker (services/whatsapp/msgcrypto.go — SAME format and
// derivation, keep them in sync) both hold the key, since the worker must see plaintext to talk to
// WhatsApp.
//
// Format: "encm:v1:" + base64(iv[12] | gcmTag[16] | ciphertext). Values without the prefix are
// legacy plaintext and pass through decryptBody() unchanged — no migration required.
//
// If MESSAGE_SECRET_KEY is unset we do NOT encrypt (pass-through) rather than fall back to some
// other secret: a mismatched fallback between web and worker would corrupt message delivery.

const PREFIX = "encm:v1:";
const SALT = "hiraticket-messages";

export function msgCryptoEnabled(): boolean {
  return !!process.env.MESSAGE_SECRET_KEY;
}

function tenantKey(businessId: string): Buffer {
  return Buffer.from(hkdfSync("sha256", process.env.MESSAGE_SECRET_KEY!, SALT, businessId, 32));
}

export function isEncryptedBody(v: unknown): boolean {
  return typeof v === "string" && v.startsWith(PREFIX);
}

/** Encrypt a message body for storage. Empty/null bodies and missing-key setups pass through. */
export function encryptBody(businessId: string, plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return plain ?? null;
  if (!plain || !msgCryptoEnabled() || isEncryptedBody(plain)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tenantKey(businessId), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

/** Decrypt a stored body. Legacy plaintext (no prefix) is returned as-is; failures return "". */
export function decryptBody(businessId: string, stored: string | null | undefined): string {
  if (!stored) return stored ?? "";
  if (!isEncryptedBody(stored)) return stored;
  if (!msgCryptoEnabled()) return "";
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const decipher = createDecipheriv("aes-256-gcm", tenantKey(businessId), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}
