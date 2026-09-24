import type { OrganizationMember, Role } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import type { OrgAccess } from "./authorization.service.js";
import { toPublicMembership } from "./organization.types.js";
import { systemRoleId } from "./role.seed.js";
import {
  ROLE_LEVEL,
  SystemRole,
  canChangeRoleOf,
  isDirectlyAssignableRole,
} from "./roles.js";
import {
  writeSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import type { RequestMeta } from "./organization.service.js";

type MemberRow = OrganizationMember & {
  user?: {
    id: string;
    email: string;
    emailVerifiedAt: Date | null;
  };
  role?: Role;
};

/** Memberships of an organization, newest members first. Caller gates access. */
export async function listMembers(
  organizationId: string,
): Promise<MemberRow[]> {
  return prisma.organizationMember.findMany({
    where: { organizationId },
    include: { user: true, role: true },
    orderBy: { joinedAt: "desc" },
  });
}

/** Loads a membership that belongs to `organizationId` (tenant-scoped). */
async function findMemberInOrganization(
  organizationId: string,
  memberId: string,
): Promise<MemberRow | null> {
  return prisma.organizationMember.findFirst({
    where: { id: memberId, organizationId },
    include: { user: true, role: true },
  });
}

/** Whether this membership is an OWNER and the organization's only owner. */
async function isFinalOwner(
  organizationId: string,
  member: MemberRow,
): Promise<boolean> {
  if (member.role?.name !== SystemRole.Owner) return false;
  const ownerCount = await prisma.organizationMember.count({
    where: {
      organizationId,
      status: "ACTIVE",
      role: { is: { name: SystemRole.Owner } },
    },
  });
  return ownerCount <= 1;
}

async function requireMemberInOrganization(
  organizationId: string,
  memberId: string,
): Promise<MemberRow> {
  const member = await findMemberInOrganization(organizationId, memberId);
  if (!member) {
    throw AppError.notFound("Member not found.");
  }
  return member;
}

/**
 * Changes another member's role. Never assigns OWNER (ownership is reachable
 * only through `transferOwnership`); protects the final owner from demotion [];
 * prevents targets above the actor's authority from being touched.
 */
export async function changeMemberRole(
  _access: OrgAccess,
  organizationId: string,
  memberId: string,
  targetRoleName: string,
  actorUserId: string,
  actorRoleName: string,
  meta: RequestMeta,
): Promise<MemberRow> {
  if (!isDirectlyAssignableRole(targetRoleName)) {
    throw AppError.ownerRequired(
      "OWNER role changes require the ownership-transfer flow.",
    );
  }

  const member = await requireMemberInOrganization(organizationId, memberId);
  const targetRoleId = await systemRoleId(targetRoleName);
  if (!targetRoleId) {
    throw new Error("System roles are not seeded. Run npm run db:seed.");
  }

  const actorLevel = ROLE_LEVEL[actorRoleName] ?? 0;
  const targetLevel = ROLE_LEVEL[member.role?.name ?? ""] ?? 0;
  const newLevel = ROLE_LEVEL[targetRoleName] ?? 0;

  if (!canChangeRoleOf(actorLevel, targetLevel, newLevel)) {
    throw AppError.forbidden(
      "You are not allowed to assign this role to this member.",
    );
  }

  if (
    member.role?.name === SystemRole.Owner &&
    (await isFinalOwner(organizationId, member))
  ) {
    throw AppError.ownerRequired(
      "The organization must retain at least one owner.",
    );
  }

  if (member.role?.name === targetRoleName) {
    // Deterministic no-op — the member already holds this role.
    return member;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationMember.update({
      where: { id: member.id },
      data: { roleId: targetRoleId },
      include: { user: true, role: true },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.MEMBER_ROLE_CHANGED,
      userId: member.userId,
      organizationId,
      metadata: {
        byUserId: actorUserId,
        fromRole: member.role?.name ?? null,
        toRole: targetRoleName,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return updated;
  });
}

/**
 * Explicit, auditable ownership transfer. The acting OWNER designates another
 * ACTIVE member as the new owner and steps down to ADMIN. Both transitions and
 * the audit event happen in one transaction.
 */
export async function transferOwnership(
  _access: OrgAccess,
  organizationId: string,
  targetMemberId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<{ oldOwner: MemberRow; newOwner: MemberRow }> {
  const target = await requireMemberInOrganization(
    organizationId,
    targetMemberId,
  );
  if (target.userId === actorUserId) {
    throw AppError.conflict("You are already the owner.");
  }
  if (target.status !== "ACTIVE") {
    throw AppError.forbidden("The new owner must be an active member.");
  }

  const actorMembership = await prisma.organizationMember.findFirst({
    where: { organizationId, userId: actorUserId },
  });
  if (!actorMembership || actorMembership.status !== "ACTIVE") {
    throw AppError.forbidden();
  }

  const [ownerRoleId, adminRoleId] = await Promise.all([
    systemRoleId(SystemRole.Owner),
    systemRoleId(SystemRole.Admin),
  ]);
  if (!ownerRoleId || !adminRoleId) {
    throw new Error("System roles are not seeded. Run npm run db:seed.");
  }

  return prisma.$transaction(async (tx) => {
    const oldOwner = await tx.organizationMember.update({
      where: { id: actorMembership.id },
      data: { roleId: adminRoleId },
      include: { user: true, role: true },
    });
    const newOwner = await tx.organizationMember.update({
      where: { id: target.id },
      data: { roleId: ownerRoleId },
      include: { user: true, role: true },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.OWNERSHIP_TRANSFERRED,
      userId: target.userId,
      organizationId,
      metadata: {
        fromUserId: actorUserId,
        actorRoleBefore: SystemRole.Owner,
        actorRoleAfter: SystemRole.Admin,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return { oldOwner, newOwner };
  });
}

/**
 * Suspends or reactivates a member. The final owner can never be suspended;
 * REMOVED members must be re-invited instead of reactivated.
 */
export async function setMemberStatus(
  _access: OrgAccess,
  organizationId: string,
  memberId: string,
  status: "ACTIVE" | "SUSPENDED",
  actorUserId: string,
  meta: RequestMeta,
): Promise<MemberRow> {
  const member = await requireMemberInOrganization(organizationId, memberId);
  if (member.status === "REMOVED") {
    throw AppError.conflict(
      "A removed member cannot be reinstated; invite them again.",
    );
  }
  if (member.status === status) {
    return member; // deterministic no-op
  }
  if (status === "SUSPENDED" && member.role?.name === SystemRole.Owner) {
    if (await isFinalOwner(organizationId, member)) {
      throw AppError.ownerRequired("The final owner cannot be suspended.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationMember.update({
      where: { id: member.id },
      data: { status },
      include: { user: true, role: true },
    });
    await writeSecurityEvent(tx, {
      type:
        status === "SUSPENDED"
          ? SecurityEventType.MEMBER_SUSPENDED
          : SecurityEventType.MEMBER_REACTIVATED,
      userId: member.userId,
      organizationId,
      metadata: { byUserId: actorUserId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return updated;
  });
}

/**
 * Removes a member (soft lifecycle state REMOVED). The final owner can never
 * be removed. Removing keeps the row for audit and re-invitation purposes.
 */
export async function removeMember(
  _access: OrgAccess,
  organizationId: string,
  memberId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<MemberRow> {
  const member = await requireMemberInOrganization(organizationId, memberId);
  if (member.status === "REMOVED") {
    throw AppError.conflict("This member has already been removed.");
  }
  if (member.role?.name === SystemRole.Owner) {
    if (actorUserId === member.userId) {
      throw AppError.ownerRequired("The owner cannot remove themselves.");
    }
    if (await isFinalOwner(organizationId, member)) {
      throw AppError.ownerRequired("The final owner cannot be removed.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.organizationMember.update({
      where: { id: member.id },
      data: { status: "REMOVED" },
      include: { user: true, role: true },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.MEMBER_REMOVED,
      userId: member.userId,
      organizationId,
      metadata: { byUserId: actorUserId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return updated;
  });
}

export { toPublicMembership };
