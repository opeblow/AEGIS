import type { User, Session } from "@prisma/client";

/** Public, client-safe representation of a user. */
export interface PublicUser {
  id: string;
  email: string;
  emailVerified: boolean;
  status: User["status"];
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

/** Public, client-safe representation of a session. */
export interface PublicSession {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  userAgent: string | null;
  ipAddress: string | null;
}

/**
 * Resolved authentication context attached to the request by the
 * `authenticate` middleware. Contains safe user/session data only — never
 * password hashes or raw tokens.
 */
export interface AuthContext {
  user: PublicUser;
  session: PublicSession;
  rawSessionRow: Session;
  rawUserRow: User;
}

/**
 * Domain type for a created session: the raw token is handed to the client
 * exactly once (as a cookie); everything else is server-side only.
 */
export interface CreatedSession {
  rawToken: string;
  csrfRawToken: string;
  session: Session;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export function toPublicSession(session: Session): PublicSession {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    revokedAt: session.revokedAt,
    userAgent: session.userAgent,
    ipAddress: session.ipAddress,
  };
}

declare module "fastify" {
  export interface FastifyInstance {
    /** Attaches request.auth from the session cookie. */
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    /** CSRF synchronizer-token check; must run after `authenticate`. */
    requireCsrf: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }

  export interface FastifyRequest {
    /** Present only after the `authenticate` middleware has run. */
    auth?: AuthContext;
  }
}
