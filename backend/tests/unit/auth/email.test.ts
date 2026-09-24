import { beforeEach, describe, expect, it } from "vitest";
import {
  devEmailService,
  listDevMailbox,
  clearDevMailbox,
} from "../../../src/modules/auth/email.service.js";

describe("development email service", () => {
  beforeEach(() => clearDevMailbox());

  it("captures a verification email with a token", async () => {
    await devEmailService.sendVerification("KARINA@Example.com", "abcd-token");
    const messages = listDevMailbox();
    expect(messages).toHaveLength(1);
    const message = messages[0];
    expect(message.kind).toBe("EMAIL_VERIFICATION");
    expect(message.toNormalized).toBe("karina@example.com");
    expect(message.token).toBe("abcd-token");
    expect(message.subject).toContain("Verify");
  });

  it("captures a password-reset email with a token", async () => {
    await devEmailService.sendPasswordReset(
      "karina@example.com",
      "reset-token",
    );
    const message = listDevMailbox()[0];
    expect(message.kind).toBe("PASSWORD_RESET");
    expect(message.token).toBe("reset-token");
    expect(message.subject).toContain("Reset");
  });

  it("clears the mailbox on demand", async () => {
    await devEmailService.sendVerification("a@b.com", "t1");
    clearDevMailbox();
    expect(listDevMailbox()).toHaveLength(0);
  });
});
