import { describe, expect, it } from "vitest";
import {
  createCsrfPair,
  validateCsrfToken,
} from "../../../src/modules/auth/csrf.js";
import { hashToken } from "../../../src/modules/auth/tokens.js";

describe("csrf synchronizer token", () => {
  it("creates a raw/hash pair (hash never contains the raw value)", () => {
    const { raw, hash } = createCsrfPair();
    expect(raw.length).toBeGreaterThan(0);
    expect(hash).toBe(hashToken(raw));
    expect(hash).not.toContain(raw);
  });

  it("accepts a matching header + cookie against the stored hash", () => {
    const { raw, hash } = createCsrfPair();
    expect(validateCsrfToken(raw, raw, hash)).toBe(true);
  });

  it("rejects mismatched header/cookie values", () => {
    const { raw, hash } = createCsrfPair();
    expect(validateCsrfToken("other-value", raw, hash)).toBe(false);
    expect(validateCsrfToken(raw, "other-value", hash)).toBe(false);
  });

  it("rejects when the cookie/hash do not match the session proof", () => {
    const { raw } = createCsrfPair();
    const otherHash = hashToken("someone-elses-session-proof");
    expect(validateCsrfToken(raw, raw, otherHash)).toBe(false);
  });

  it("rejects missing inputs", () => {
    const { raw, hash } = createCsrfPair();
    expect(validateCsrfToken(undefined, raw, hash)).toBe(false);
    expect(validateCsrfToken(raw, undefined, hash)).toBe(false);
    expect(validateCsrfToken(raw, raw, undefined)).toBe(false);
    expect(validateCsrfToken(undefined, undefined, undefined)).toBe(false);
  });
});
