import { createHash, randomBytes } from "node:crypto";

export const TOKEN_BYTES = 32;
export const TOKEN_HASH_ALGORITHM = "sha256";
/** Upper bound for client-supplied token values (validates request body size). */
export const TOKEN_RAW_MAX_LENGTH = 128;

/**
 * Generates an opaque, high-entropy token (256 bits) suitable for session,
 * verification, and password-reset tokens. Contains no user or policy data.
 */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * One-way hash of an opaque token. Only the hash is ever persisted — a
 * database leak never reveals usable tokens, and the hash cannot be reversed
 * into the token because the token itself has full 256-bit entropy.
 */
export function hashToken(token: string): string {
  return createHash(TOKEN_HASH_ALGORITHM).update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison helper (avoids leaking equality through timing).
 */
export function safeTokenEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return cryptoCompare(aBuf, bBuf);
}

function cryptoCompare(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
