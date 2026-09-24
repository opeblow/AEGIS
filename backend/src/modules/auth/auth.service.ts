import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";
import type { PublicUser } from "./auth.types.js";
import {
  normalizeEmail,
  registerUser,
  findUserByEmail,
  findUserById,
  publicUser,
} from "./user.service.js";
import {
  createSession,
  findSessionByToken,
  revokeSession,
  revokeAllSessions,
  revokeAllSessionsExcept,
} from "./session.service.js";
import {
  createEmailVerification,
  verifyEmailToken,
} from "./verification.service.js";
import {
  createPasswordReset,
  applyPasswordReset,
} from "./password-reset.service.js";
import {
  verifyPassword,
  hashPassword,
  passwordMissWithoutTimingLeak,
} from "./passwords.js";
import { recordSecurityEvent, SecurityEventType } from "./security-events.js";
import { devEmailService } from "./email.service.js";

interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface LoginResult {
  user: PublicUser;
  rawToken: string;
  csrfRawToken: string;
}

/**
 * Whether recent failed login attempts for a normalized email exceed the
 * throttle threshold. Backed by LOGIN_FAILED security events so throttling is
 * durable and identical whether or not the account exists (no enumeration).
 */
async function isLoginThrottled(email: string): Promise<boolean> {
  const env = getEnv();
  const windowStart = new Date(Date.now() - env.AUTH_LOGIN_THROTTLE_MS);
  const recentFailures = await prisma.securityEvent.count({
    where: {
      type: SecurityEventType.LOGIN_FAILED,
      createdAt: { gte: windowStart },
      metadata: { path: ["email"], equals: email },
    },
  });
  return recentFailures >= env.AUTH_LOGIN_MAX_ATTEMPTS;
}

export async function register(
  input: { email: string; password: string } & RequestMeta,
): Promise<{ user: PublicUser; alreadyExists: boolean }> {
  const result = await registerUser({
    email: input.email,
    password: input.password,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });
  return { user: publicUser(result.user), alreadyExists: result.alreadyExists };
}

export async function issueEmailVerification(
  userId: string,
  email: string,
  meta: RequestMeta,
): Promise<void> {
  const { rawToken } = await createEmailVerification(userId);
  await devEmailService.sendVerification(email, rawToken);
  await recordSecurityEvent({
    type: SecurityEventType.EMAIL_VERIFICATION_REQUESTED,
    userId,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

export async function login(
  emailInput: string,
  password: string,
  meta: RequestMeta,
): Promise<LoginResult> {
  const email = normalizeEmail(emailInput);

  if (await isLoginThrottled(email)) {
    throw AppError.tooMany();
  }

  const user = await findUserByEmail(email);
  let passwordValid: boolean;

  if (!user) {
    // Equalize timing with real accounts by running a dummy verification.
    await passwordMissWithoutTimingLeak();
    passwordValid = false;
  } else {
    passwordValid = await verifyPassword(password, user.passwordHash);
  }

  if (!user || !passwordValid || user.status !== "ACTIVE") {
    // Generic failure regardless of the actual cause (unknown email, bad
    // password, suspended/disabled account).
    await recordSecurityEvent({
      type: SecurityEventType.LOGIN_FAILED,
      userId: user?.id ?? undefined,
      metadata: { email },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw AppError.unauthorized("Invalid email or password.");
  }

  const created = await createSession(user.id, meta);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  await recordSecurityEvent({
    type: SecurityEventType.LOGIN_SUCCESS,
    userId: user.id,
    metadata: { email: user.email, sessionId: created.session.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    user: publicUser(user),
    rawToken: created.rawToken,
    csrfRawToken: created.csrfRawToken,
  };
}

/** Revokes the session identified by a raw token. Returns whether one was revoked. */
export async function logout(
  rawToken: string | undefined,
  meta: RequestMeta,
): Promise<{ revoked: boolean; userId?: string }> {
  if (!rawToken) return { revoked: false };
  const session = await findSessionByToken(rawToken);
  if (!session || session.revokedAt) return { revoked: false };

  await revokeSession(session.id, session.userId);
  await recordSecurityEvent({
    type: SecurityEventType.LOGOUT,
    userId: session.userId,
    metadata: { sessionId: session.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return { revoked: true, userId: session.userId };
}

export async function logoutAll(
  userId: string,
  keepSessionId: string | null,
  meta: RequestMeta,
): Promise<number> {
  const revoked =
    keepSessionId === null
      ? await revokeAllSessions(userId)
      : await revokeAllSessionsExcept(userId, keepSessionId);
  void recordSecurityEvent({
    type: SecurityEventType.LOGOUT_ALL,
    userId,
    metadata: { keepSessionId, revoked },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
  return revoked;
}

export async function verifyEmail(
  rawToken: string,
  meta: RequestMeta,
): Promise<PublicUser> {
  const userId = await verifyEmailToken(rawToken);
  const user = await findUserById(userId);
  if (!user)
    throw AppError.validation("Invalid or expired verification token.");

  void recordSecurityEvent({
    type: SecurityEventType.EMAIL_VERIFIED,
    userId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicUser(user);
}

export async function resendVerification(
  emailInput: string,
  meta: RequestMeta,
): Promise<void> {
  const email = normalizeEmail(emailInput);
  const user = await findUserByEmail(email);

  if (user && !user.emailVerifiedAt) {
    await issueEmailVerification(user.id, user.email, meta);
  }
  // Identity-agnostic response is handled by the route layer.
}

export async function forgotPassword(
  emailInput: string,
  meta: RequestMeta,
): Promise<void> {
  const email = normalizeEmail(emailInput);
  const user = await findUserByEmail(email);

  if (user) {
    const { rawToken } = await createPasswordReset(user.id);
    await devEmailService.sendPasswordReset(email, rawToken);
    await recordSecurityEvent({
      type: SecurityEventType.PASSWORD_RESET_REQUESTED,
      userId: user.id,
      metadata: { email: user.email },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}

export async function resetPassword(
  rawToken: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<PublicUser> {
  const userId = await applyPasswordReset(rawToken, newPassword);
  if (!userId) {
    throw AppError.validation("Invalid or expired password reset token.");
  }

  await revokeAllSessions(userId);

  const user = await findUserById(userId);
  if (!user)
    throw AppError.validation("Invalid or expired password reset token.");

  await recordSecurityEvent({
    type: SecurityEventType.PASSWORD_RESET_COMPLETED,
    userId: user.id,
    metadata: { email: user.email },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return publicUser(user);
}

export async function changePassword(
  userId: string,
  currentSessionId: string,
  currentPassword: string,
  newPassword: string,
  meta: RequestMeta,
): Promise<{ revokedOthers: number }> {
  const user = await findUserById(userId);
  if (!user) throw AppError.unauthorized();

  const currentValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!currentValid) {
    await recordSecurityEvent({
      type: SecurityEventType.LOGIN_FAILED,
      userId: user.id,
      metadata: {
        email: user.email,
        reason: "change_password_current_incorrect",
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw AppError.unauthorized("Current password is incorrect.");
  }

  const newHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  const revokedOthers = await revokeAllSessionsExcept(userId, currentSessionId);

  await recordSecurityEvent({
    type: SecurityEventType.PASSWORD_CHANGED,
    userId: user.id,
    metadata: { email: user.email, revokedOthers },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { revokedOthers };
}
