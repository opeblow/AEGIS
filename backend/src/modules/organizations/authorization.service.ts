import type { FastifyRequest } from "fastify";
import type {
  Organization,
  OrganizationMember,
  Permission,
  Role,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import type { AuthContext } from "../auth/auth.types.js";

type PermissionGranted = Role & {
  permissions: Array<{ permission: Permission }>;
};

export interface OrgAccess {
  organization: Organization;
  membership: OrganizationMember;
  role: PermissionGranted;
  /** Resolved set of permission identifiers granted by the member's role. */
  permissions: Set<string>;
  roleName: string;
}

export type OrgAccessResult =
  | { ok: true; access: OrgAccess }
  | { ok: false; reason: "org_unavailable" | "not_member" | "suspended" };

/**
 * Resolution chain (Aegis is organization-first):
 *
 *   authenticate user -> resolve org -> resolve membership -> resolve role ->
 *   resolve permissions -> authorize the operation.
 *
 * DB lookups are organization-scoped (`where: { organizationId, userId }`),
 * so identifiers supplied by a client can never leak data from another
 * tenant.
 */
export async function resolveOrganizationAccess(
  organizationId: string,
  userId: string,
): Promise<OrgAccessResult> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
  });
  if (!organization || organization.status !== "ACTIVE") {
    return { ok: false, reason: "org_unavailable" };
  }

  const membership = await prisma.organizationMember.findFirst({
    where: { organizationId, userId },
    include: {
      role: { include: { permissions: { include: { permission: true } } } },
    },
  });
  if (!membership) {
    return { ok: false, reason: "not_member" };
  }
  if (membership.status !== "ACTIVE") {
    return {
      ok: false,
      reason: membership.status === "SUSPENDED" ? "suspended" : "not_member",
    };
  }

  const permissions = new Set(
    (membership.role?.permissions ?? []).map((rp) => rp.permission.name),
  );

  return {
    ok: true,
    access: {
      organization,
      membership,
      role: membership.role as PermissionGranted,
      permissions,
      roleName: membership.role?.name ?? "UNKNOWN",
    },
  };
}

/** Maps an OrgAccessResult failure onto a client-safe AppError. */
export function throwFromOrgAccess(result: OrgAccessResult): never {
  if (!result.ok && result.reason === "suspended") {
    throw AppError.membershipSuspended();
  }
  // Unavailable orgs and non-members collapse to the same generic 404 so a
  // client cannot learn whether an organization id exists.
  throw AppError.notFound("Organization not found.");
}

/**
 * Resolves the authenticated user's ACTIVE membership in an organization and
 * throws when they have no usable access. Never leaks whether an
 * organization exists to non-members.
 */
export async function requireOrganizationAccess(
  organizationId: string,
  userId: string,
): Promise<OrgAccess> {
  const result = await resolveOrganizationAccess(organizationId, userId);
  if (!result.ok) throwFromOrgAccess(result);
  return result.access;
}

/** Throws unless the resolved role grants `permission`. */
export function requirePermission(
  access: OrgAccess,
  permission: string,
): OrgAccess {
  if (!access.permissions.has(permission)) {
    throw AppError.forbidden();
  }
  return access;
}

/** Throws unless the member holds exactly `roleName`. */
export function requireRole(access: OrgAccess, roleName: string): OrgAccess {
  if (access.roleName !== roleName) {
    throw AppError.forbidden();
  }
  return access;
}

function requireAuthContext(request: FastifyRequest): AuthContext {
  if (!request.auth) throw AppError.unauthorized();
  return request.auth;
}

/**
 * Full authorization gate for organization-scoped handlers:
 *
 *   authenticate -> active membership -> permission.
 *
 * Attaches nothing to the request; returns the resolved access context so a
 * handler can surface the organization or role without a second lookup.
 */
export async function authorize(
  request: FastifyRequest,
  organizationId: string,
  permission: string,
): Promise<OrgAccess> {
  const auth = requireAuthContext(request);
  const access = await requireOrganizationAccess(organizationId, auth.user.id);
  requirePermission(access, permission);
  void touchMembershipLastActive(access.membership);
  return access;
}

/** Authorization gate for owner-only operations (ownership transfer). */
export async function authorizeOwner(
  request: FastifyRequest,
  organizationId: string,
): Promise<OrgAccess> {
  const auth = requireAuthContext(request);
  const access = await requireOrganizationAccess(organizationId, auth.user.id);
  requireRole(access, "OWNER");
  void touchMembershipLastActive(access.membership);
  return access;
}

/** Actor id of the current authenticated user (throws when absent). */
export function actorUserId(request: FastifyRequest): string {
  return requireAuthContext(request).user.id;
}

const MEMBERSHIP_TOUCH_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Best-effort, throttled refresh of a member's lastActiveAt so org activity
 * is visible without churning the database on every request.
 */
export async function touchMembershipLastActive(
  membership: OrganizationMember,
): Promise<void> {
  if (!membership.lastActiveAt) {
    await prisma.organizationMember
      .update({
        where: { id: membership.id },
        data: { lastActiveAt: new Date() },
      })
      .catch(() => undefined);
    return;
  }
  if (
    Date.now() - membership.lastActiveAt.getTime() <
    MEMBERSHIP_TOUCH_THROTTLE_MS
  ) {
    return;
  }
  await prisma.organizationMember
    .update({
      where: { id: membership.id },
      data: { lastActiveAt: new Date() },
    })
    .catch(() => undefined);
}
