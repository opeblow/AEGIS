import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  CSRF_COOKIE,
  sessionCookieName,
  csrfCookieName,
  sessionCookieOptions,
  csrfCookieOptions,
  clearCookieOptions,
  getCookieSecure,
} from "../../../src/modules/auth/cookies.js";

describe("cookie config (development/test env)", () => {
  it("uses plain cookie names when Secure is not set", () => {
    // vitest pins AUTH_COOKIE_SECURE=false -> no __Host- prefix in tests.
    expect(getCookieSecure()).toBe(false);
    expect(sessionCookieName()).toBe(SESSION_COOKIE);
    expect(csrfCookieName()).toBe(CSRF_COOKIE);
  });

  it("marks the session cookie HttpOnly + SameSite=Lax", () => {
    const opts = sessionCookieOptions(3600);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(3600);
    expect(opts.secure).toBe(false);
  });

  it("keeps the CSRF cookie readable by JavaScript (HttpOnly off)", () => {
    const opts = csrfCookieOptions(3600);
    expect(opts.httpOnly).toBe(false);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
  });

  it("clears cookies with a matching path", () => {
    expect(clearCookieOptions()).toMatchObject({
      secure: false,
      path: "/",
    });
  });
});
