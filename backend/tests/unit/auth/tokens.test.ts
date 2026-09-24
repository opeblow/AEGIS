import { describe, expect, it } from "vitest";
import {
  TOKEN_BYTES,
  TOKEN_HASH_ALGORITHM,
  generateToken,
  hashToken,
  safeTokenEqual,
} from "../../../src/modules/auth/tokens.js";

describe("token utilities", () => {
  it("generates an opaque 256-bit base64url token", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 bytes -> 43 base64url chars (no padding)
    expect(a.length).toBe(Math.ceil((TOKEN_BYTES * 8) / 6));
  });

  it("produces a deterministic 64-char hex SHA-256 hash", () => {
    const token = generateToken();
    const h1 = hashToken(token);
    const h2 = hashToken(token);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(TOKEN_HASH_ALGORITHM).toBe("sha256");
    expect(h1).toEqual(h2);
    // The hash is not the token and cannot be reversed from the hash alone.
    expect(h1).not.toContain(token);
  });

  it("hashes differently for different tokens", () => {
    expect(hashToken(generateToken())).not.toEqual(hashToken(generateToken()));
  });

  it("compares tokens in constant-time semantics", () => {
    expect(safeTokenEqual("abc", "abc")).toBe(true);
    expect(safeTokenEqual("abc", "abd")).toBe(false);
    expect(safeTokenEqual("abc", "abcd")).toBe(false);
    expect(safeTokenEqual("", "")).toBe(true);
  });
});
