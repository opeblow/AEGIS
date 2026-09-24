import type { CookieSerializeOptions } from "@fastify/cookie";
import { getEnv } from "../../config/env.js";

export const SESSION_COOKIE = "aegis_session";
export const CSRF_COOKIE = "aegis_csrf";

// The __Host- prefix is only legal when the cookie is Secure, Path=/, and has
// no Domain attribute. We use it in production (always HTTPS); in local HTTP
// development we use the plain name.
export function isCookiePrefixHostAllowed(): boolean {
  return getCookieSecure();
}

export function getCookieSecure(): boolean {
  const env = getEnv();
  if (env.AUTH_COOKIE_SECURE !== undefined) return env.AUTH_COOKIE_SECURE;
  return env.NODE_ENV === "production";
}

function cookieName(base: string): string {
  return isCookiePrefixHostAllowed() ? `__Host-${base}` : base;
}

export function sessionCookieName(): string {
  return cookieName(SESSION_COOKIE);
}

export function csrfCookieName(): string {
  return cookieName(CSRF_COOKIE);
}

export function sessionCookieOptions(
  maxAgeSeconds: number,
): CookieSerializeOptions {
  return {
    httpOnly: true, // never visible to JavaScript
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** The CSRF token cookie must be readable by the client so it can echo it. */
export function csrfCookieOptions(
  maxAgeSeconds: number,
): CookieSerializeOptions {
  return {
    httpOnly: false,
    secure: getCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Options for clearing both cookies on logout (Path must match set-path). */
export function clearCookieOptions(): CookieSerializeOptions {
  return {
    secure: getCookieSecure(),
    path: "/",
  };
}
