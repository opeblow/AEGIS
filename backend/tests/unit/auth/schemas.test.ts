import { describe, expect, it } from "vitest";
import {
  registerBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  uuidParamSchema,
  emailSchema,
} from "../../../src/modules/auth/schemas.js";

describe("auth request schemas", () => {
  it("validates a register body and exposes email/password", () => {
    const parsed = registerBodySchema.parse({
      email: "KARINA@Example.com ",
      password: "correct-horse-battery-staple",
    });
    expect(parsed.email).toBe("KARINA@Example.com");
    expect(parsed.password).toBe("correct-horse-battery-staple");
  });

  it("rejects a short password (min 6 in test env)", () => {
    const result = registerBodySchema.safeParse({
      email: "karina@example.com",
      password: "12345",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["password"]);
    }
  });

  it("rejects an invalid email", () => {
    for (const email of ["not-an-email", "", "a@", "@b.com"]) {
      expect(emailSchema.safeParse(email).success).toBe(false);
    }
  });

  it("normalizes the login email through trim alone", () => {
    const parsed = loginBodySchema.parse({
      email: "  karina@example.com  ",
      password: "secret",
    });
    expect(parsed.email).toBe("karina@example.com");
  });

  it("accepts a reset-password body only with a token and password", () => {
    expect(
      resetPasswordBodySchema.safeParse({
        token: "",
        password: "correct-horse-battery-staple",
      }).success,
    ).toBe(false);
    expect(
      resetPasswordBodySchema.safeParse({
        token: "x".repeat(43),
        password: "correct-horse-battery-staple",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid session id", () => {
    expect(uuidParamSchema.safeParse({ sessionId: "not-a-uuid" }).success).toBe(
      false,
    );
    expect(uuidParamSchema.safeParse({ sessionId: "nope" }).success).toBe(
      false,
    );
  });
});
