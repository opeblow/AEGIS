import { Prisma, type User } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { toPublicUser, type PublicUser } from "./auth.types.js";
import { hashPassword } from "./passwords.js";
import { recordSecurityEvent, SecurityEventType } from "./security-events.js";

export const EMAIL_MAX_LENGTH = 254;

/**
 * Normalizes an email for storage and lookup.
 *
 * Policy: trim surrounding whitespace and lowercase the complete address.
 * This is a consistent, deterministic normalization that collapses
 * case-variants. Provider-specific transforms (Gmail dot removal, plus-address
 * stripping) are intentionally NOT applied.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface RegisterInput {
  email: string;
  password: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Creates a new user account. Email uniqueness is enforced by a UNIQUE
 * database constraint; the pre-check is a fast path that yields a clean 409.
 */
export async function registerUser(
  input: RegisterInput,
): Promise<{ user: User; alreadyExists: boolean }> {
  const email = normalizeEmail(input.email);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    void recordSecurityEvent({
      type: SecurityEventType.USER_REGISTERED,
      metadata: { email, outcome: "duplicate" },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    return { user: existing, alreadyExists: true };
  }

  const now = new Date();
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(input.password),
        emailVerifiedAt: null,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      // Raced another registration for the same email — treat as duplicate.
      const raced = await prisma.user.findUnique({ where: { email } });
      if (raced) return { user: raced, alreadyExists: true };
    }
    throw err;
  }

  void recordSecurityEvent({
    type: SecurityEventType.USER_REGISTERED,
    userId: user.id,
    metadata: { email: user.email },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return { user, alreadyExists: false };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/**
 * Loads a user and fails with a generic authentication error if the account
 * should not be able to authenticate (suspended/disabled) — the caller must
 * not learn why via distinguishable error messages.
 */
export async function getUserForAuth(id: string): Promise<User> {
  const user = await findUserById(id);
  if (!user || user.status !== "ACTIVE") {
    throw AppError.unauthorized();
  }
  return user;
}

export function publicUser(user: User): PublicUser {
  return toPublicUser(user);
}

export function emailExists(email: string): Promise<boolean> {
  return prisma.user
    .findUnique({ where: { email: normalizeEmail(email) } })
    .then((u) => u !== null);
}
