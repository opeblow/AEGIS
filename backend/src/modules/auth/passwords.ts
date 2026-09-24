import { randomBytes } from "node:crypto";
import { argon2id, argon2Verify } from "hash-wasm";
import { getEnv } from "../../config/env.js";

// ---------------------------------------------------------------------------
// Password policy decision (documented in the README):
//
//   - Hashing: Argon2id (OWASP preferred modern password hashing), via
//     hash-wasm, a WASM implementation — no native addon, so it runs wherever
//     Windows Application Control blocks unsigned native binaries.
//   - Unique random salt per password (generated via node:crypto, embedded in
//     the PHC-encoded hash string).
//   - Parameters: memoryCost 65536 KiB (64 MiB), timeCost 3, parallelism 4,
//     hashLength 32. These meet OWASP minimums (>= 19 MiB, t >= 2).
//   - Pepper: optional server-side secret fed through Argon2's `secret`
//     parameter. Stored out-of-band via env/secret management, never in
//     PostgreSQL. If unset, strong per-password salts + secret management of
//     DATABASE_URL provide the defense.
//   - Passwords are NEVER plaintext/encrypted/logged/returned by the API.
// ---------------------------------------------------------------------------

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

export function getPasswordPolicy(): PasswordPolicy {
  const env = getEnv();
  return {
    minLength: env.AUTH_PASSWORD_MIN_LENGTH,
    maxLength: env.AUTH_PASSWORD_MAX_LENGTH,
  };
}

function resolveSecret(): Uint8Array | undefined {
  const env = getEnv();
  if (!env.PASSWORD_PEPPER) return undefined;
  return Buffer.from(env.PASSWORD_PEPPER, "utf8");
}

const PASSWORD_HASH_PARAMS = {
  memorySize: 65_536, // 64 MiB
  iterations: 3,
  parallelism: 4,
  hashLength: 32,
} as const;

/**
 * Hashes a password with Argon2id. The resulting string embeds its unique
 * salt, parameters, and optional pepper reference; it is safe to store as-is.
 */
export async function hashPassword(password: string): Promise<string> {
  return argon2id({
    password,
    salt: randomBytes(16),
    secret: resolveSecret(),
    ...PASSWORD_HASH_PARAMS,
    outputType: "encoded",
  });
}

/**
 * Verifies a password against a stored Argon2id hash using the library's
 * safe equality path (which is timing-safe).
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    return await argon2Verify({
      password,
      hash: storedHash,
      secret: resolveSecret(),
    });
  } catch {
    // Malformed stored hash (e.g. legacy/wrong-format) == verification failure.
    return false;
  }
}

/**
 * Computes a valid but useless Argon2id hash lazily so that login attempts
 * against a non-existent email still pay a comparable verifying cost. This
 * flattens the timing signal that would otherwise reveal account existence.
 */
let dummyHashPromise: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= argon2id({
    password: "aegis-dummy-password",
    salt: randomBytes(16),
    secret: resolveSecret(),
    ...PASSWORD_HASH_PARAMS,
    outputType: "encoded",
  });
  return dummyHashPromise;
}

/**
 * Runs password verification against the shared dummy hash to equalize login
 * timing for accounts that do not exist.
 */
export async function passwordMissWithoutTimingLeak(): Promise<void> {
  const dummy = await getDummyPasswordHash();
  await argon2Verify({
    password: "aegis-dummy-password",
    hash: dummy,
    secret: resolveSecret(),
  });
}
