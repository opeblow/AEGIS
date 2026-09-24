import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import { generateToken, hashToken } from "./tokens.js";
import { hashPassword } from "./passwords.js";

export interface CreatedPasswordReset {
  rawToken: string;
}

/**
 * Creates a single-use, time-limited password-reset challenge and returns the
 * raw token (delivered via email; only the hash is stored).
 */
export async function createPasswordReset(
  userId: string,
): Promise<CreatedPasswordReset> {
  const env = getEnv();
  const rawToken = generateToken();
  const now = new Date();

  await prisma.passwordReset.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + env.AUTH_PASSWORD_RESET_TOKEN_TTL_MS),
    },
  });

  return { rawToken };
}

/**
 * Applies a password reset. Validates the token (exists, unused, unexpired),
 * sets the new Argon2id hash, consumes the token, and returns the user id so
 * the caller can revoke sessions. All failures are generic.
 *
 * Returns null when the token is invalid/expired/already used.
 */
export async function applyPasswordReset(
  rawToken: string,
  newPassword: string,
): Promise<string | null> {
  const record = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });

  if (!record || record.usedAt) return null;
  if (Date.now() > record.expiresAt.getTime()) return null;
  if (!record.user) return null;

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
  ]);

  return record.userId;
}

/** Removes expired password-reset challenges (and used ones older than a day). */
export async function cleanupExpiredPasswordResets(): Promise<number> {
  const now = new Date();
  const [expired, used] = await Promise.all([
    prisma.passwordReset.deleteMany({
      where: { expiresAt: { lt: now } },
    }),
    prisma.passwordReset.deleteMany({
      where: {
        usedAt: { not: null },
        expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  return expired.count + used.count;
}
