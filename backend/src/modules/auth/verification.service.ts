import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import { generateToken, hashToken } from "./tokens.js";
import { AppError } from "../../lib/errors/index.js";

export interface CreatedVerification {
  rawToken: string;
}

/**
 * Creates a single-use email-verification challenge for a user and returns
 * the raw token (delivered via the email service; only the hash is stored).
 */
export async function createEmailVerification(
  userId: string,
): Promise<CreatedVerification> {
  const env = getEnv();
  const rawToken = generateToken();
  const now = new Date();

  await prisma.emailVerification.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + env.AUTH_VERIFICATION_TOKEN_TTL_MS),
    },
  });

  return { rawToken };
}

/**
 * Validates a verification token. Success marks the token used (single-use),
 * records the verification time, and returns the owning user id.
 * Every failure raises a generic, non-enumerating error.
 */
export async function verifyEmailToken(rawToken: string): Promise<string> {
  const verification = await prisma.emailVerification.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!verification || verification.usedAt) {
    throw AppError.validation("Invalid or expired verification token.");
  }
  if (Date.now() > verification.expiresAt.getTime()) {
    throw AppError.validation("Invalid or expired verification token.");
  }
  if (!verification.user) {
    throw AppError.validation("Invalid or expired verification token.");
  }
  if (verification.user.emailVerifiedAt) {
    // Already verified — consume this token as used, but treat outcome as success.
    await prisma.emailVerification.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    });
    return verification.userId;
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerifiedAt: new Date() },
    }),
    prisma.emailVerification.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return verification.userId;
}

/**
 * Returns the most recent unused verification challenge for a user, if any
 * still exists (used by resend throttling).
 */
export async function lastVerificationCreatedAt(
  userId: string,
): Promise<Date | null> {
  const latest = await prisma.emailVerification.findFirst({
    where: { userId, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return latest?.createdAt ?? null;
}

/** Removes expired verification challenges (and used ones older than a day). */
export async function cleanupExpiredVerifications(): Promise<number> {
  const now = new Date();
  const [expired, used] = await Promise.all([
    prisma.emailVerification.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.emailVerification.deleteMany({
      where: {
        usedAt: { not: null },
        expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  return expired.count + used.count;
}
