import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
  getDummyPasswordHash,
  passwordMissWithoutTimingLeak,
  getPasswordPolicy,
} from "../../../src/modules/auth/passwords.js";

describe("password hashing (Argon2id)", () => {
  it("hashes and verifies a password round-trip", async () => {
    const hash = await hashPassword("Correct-Horse-2017-Staple!");
    expect(hash).toMatch(/^\$argon2id/);
    await expect(
      verifyPassword("Correct-Horse-2017-Staple!", hash),
    ).resolves.toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("Correct-Horse-2017-Staple!");
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("produces a unique hash per identical password (unique salt)", async () => {
    const a = await hashPassword("same-password-value-123");
    const b = await hashPassword("same-password-value-123");
    expect(a).not.toEqual(b);
  });

  it("verifies the shared dummy hash and fails for a random input", async () => {
    const dummy = await getDummyPasswordHash();
    expect(dummy).toMatch(/^\$argon2id/);
    await passwordMissWithoutTimingLeak(); // runs a verification pass
    // The dummy hash must not accept a used-but-random password.
    await expect(
      verifyPassword("this-is-not-the-dummy-password", dummy),
    ).resolves.toBe(false);
  });

  it("reflects the configured password policy bounds", () => {
    // vitest.config.ts pins AUTH_PASSWORD_MIN_LENGTH=6 / MAX=1024.
    const policy = getPasswordPolicy();
    expect(policy.minLength).toBe(6);
    expect(policy.maxLength).toBe(1024);
  });
});
