import type { Session } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { getEnv } from "../../config/env.js";
import { generateToken, hashToken } from "./tokens.js";
import { createCsrfPair } from "./csrf.js";
import type { CreatedSession } from "./auth.types.js";

export interface SessionMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

const TOUCH_THROTTLE_MS = 60_000;

/**
 * Creates a fresh opaque session for a user. A raw 256-bit token is returned
 * to the client exactly once (as a cookie); only its hash is persisted, along
 * with a hashed CSRF proof bound to this session.
 */
export async function createSession(
  userId: string,
  meta: SessionMeta,
): Promise<CreatedSession> {
  const env = getEnv();
  const rawToken = generateToken();
  const csrfPair = createCsrfPair();

  const now = new Date();
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      csrfTokenHash: csrfPair.hash,
      createdAt: now,
      lastUsedAt: now,
      expiresAt: new Date(now.getTime() + env.AUTH_SESSION_TTL_MS),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ipAddress ?? null,
    },
  });

  return { rawToken, csrfRawToken: csrfPair.raw, session };
}

/**
 * Resolves a raw session token to a valid (non-expired, non-revoked) session,
 * or returns null. Used by the authentication middleware and logout.
 */
export async function resolveSessionByToken(
  rawToken: string,
): Promise<Session | null> {
  if (!rawToken) return null;
  const env = getEnv();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
  if (!session || session.revokedAt) return null;
  if (Date.now() > session.expiresAt.getTime()) return null;
  if (Date.now() - session.lastUsedAt.getTime() > env.AUTH_SESSION_IDLE_MS) {
    return null;
  }
  return session;
}

/** Unconditionally resolves a session row by raw token (revocation checks by caller). */
export async function findSessionByToken(
  rawToken: string,
): Promise<Session | null> {
  return prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  });
}

/**
 * Refreshes lastUsedAt, throttled to at most once per minute so active users
 * do not churn the database on every request.
 */
export async function touchSession(session: Session): Promise<void> {
  if (Date.now() - session.lastUsedAt.getTime() < TOUCH_THROTTLE_MS) return;
  await prisma.session
    .update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })
    .catch(() => undefined);
}

/** Lists a user's sessions in recency order. */
export async function listSessions(userId: string): Promise<Session[]> {
  return prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Revokes a specific session, verifying the session belongs to `userId`.
 * Returns false (without erroring) when the session does not exist or is not
 * owned by the caller, so the response stays generic.
 */
export async function revokeSession(
  sessionId: string,
  userId: string,
): Promise<boolean> {
  const session = await prisma.session.findFirst({
    where: { id: sessionId, userId },
  });
  if (!session || session.revokedAt) return false;
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  });
  return true;
}

export async function revokeAllSessions(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Revokes every session for a user except the one they are currently using. */
export async function revokeAllSessionsExcept(
  userId: string,
  keepSessionId: string,
): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null, NOT: { id: keepSessionId } },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/**
 * Deletes authentication artifacts that are no longer usable: expired or
 * revoked sessions and long-expired sessions, plus orphaned rows. Returns the
 * number of rows removed so the cleanup job can log progress.
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const now = new Date();
  const deleteExpired = prisma.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  const deleteRevoked = prisma.session.deleteMany({
    where: {
      revokedAt: { not: null },
      expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    },
  });
  const [expired, revoked] = await Promise.all([deleteExpired, deleteRevoked]);
  return expired.count + revoked.count;
}
