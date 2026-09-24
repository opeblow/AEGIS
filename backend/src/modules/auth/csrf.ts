import { hashToken, generateToken, safeTokenEqual } from "./tokens.js";

export const CSRF_TOKEN_LENGTH_HINT = 43;

/**
 * Generates a random CSRF token and returns both the raw token (sent to the
 * client) and its hash (persisted on the session for server-side comparison).
 */
export function createCsrfPair(): { raw: string; hash: string } {
  const raw = generateToken();
  return { raw, hash: hashToken(raw) };
}

/**
 * Verifies an authenticated state-changing request's CSRF proof.
 *
 * Strategy (see README "CSRF protection"):
 *   1. The session cookie is SameSite=Lax, which already blocks the majority
 *      of cross-site CSRF flows.
 *   2. For cookie-authenticated state-changing requests we additionally use a
 *      synchronizer token: a random value is set as a readable cookie at login
 *      and its hash is stored on the session; the client must echo the raw
 *      value in the `x-csrf-token` header.
 *   3. State-changing requests without a matching proof are rejected with 403.
 *
 * Returns true when the request carries a valid CSRF proof.
 */
export function validateCsrfToken(
  headerValue: string | undefined,
  csrfCookieValue: string | undefined,
  storedCsrfTokenHash: string | null | undefined,
): boolean {
  if (!headerValue || !csrfCookieValue || !storedCsrfTokenHash) return false;
  if (!safeTokenEqual(headerValue, csrfCookieValue)) return false;
  return safeTokenEqual(hashToken(csrfCookieValue), storedCsrfTokenHash);
}
