import type {
  Organization,
  OrganizationInvitation,
  Role,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { normalizeEmail } from "../auth/user.service.js";
import { devEmailService } from "../auth/email.service.js";
import {
  writeSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import type { OrgAccess } from "./authorization.service.js";
import { systemRoleId } from "./role.seed.js";
import { SystemRole } from "./roles.js";
import {
  invitationState,
  toPublicInvitation,
  toPublicMembership,
  type InvitationState,
} from "./organization.types.js";
import type { CreateInvitationBody } from "./organization.schemas.js";
import type { RequestMeta } from "./organization.service.js";
import { getEnv } from "../../config/env.js";

type InvitationRow = OrganizationInvitation & {
  organization?: Organization;
  role?: Role | null;
};

export interface InvitationLookup {
  invitation: InvitationRow;
  state: InvitationState;
}

/**
 * Creates an organization invitation. The raw 256-bit token is generated and
 * delivered via the (development) email service; only its SHA-256 hash is
 * persisted. Deterministic duplicate handling: a pending invitation for the
 * same email — or an already-active membership for that email — is a CONFLICT.
 */
export async function createInvitation(
  access: OrgAccess,
  organizationId: string,
  input: CreateInvitationBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<InvitationRow> {
  // Privilege-escalation guard: only an OWNER may invite into the OWNER role.
  if (input.role === SystemRole.Owner && access.roleName !== SystemRole.Owner) {
    throw AppError.forbidden(
      "Only an organization owner may invite another owner.",
    );
  }

  const email = normalizeEmail(input.email);
  const roleId = await systemRoleId(input.role);
  if (!roleId)
    throw new Error("System roles are not seeded. Run npm run db:seed.");

  const now = new Date();

  // If the invitee already belongs to the organization, refuse.
  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMembership = await prisma.organizationMember.findFirst({
      where: { organizationId, userId: existingUser.id },
      select: { status: true },
    });
    if (existingMembership && existingMembership.status === "ACTIVE") {
      throw AppError.conflict(
        "This user is already a member of the organization.",
      );
    }
  }

  // A pending (unaccepted, unrevoked, unexpired) invitation blocks duplicates.
  const pending = await prisma.organizationInvitation.findFirst({
    where: {
      organizationId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: now },
    },
  });
  if (pending) {
    throw AppError.conflict(
      "An active invitation already exists for this email.",
    );
  }

  const rawToken = generateToken();
  const env = getEnv();
  const expiresAt = new Date(now.getTime() + env.ORG_INVITATION_TTL_MS);

  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.organizationInvitation.create({
      data: {
        organizationId,
        email,
        roleId,
        tokenHash: hashToken(rawToken),
        createdByUserId: actorUserId,
        createdAt: now,
        expiresAt,
      },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.MEMBER_INVITED,
      userId: actorUserId,
      organizationId,
      metadata: {
        email,
        role: input.role,
        invitationId: created.id,
        expiresAt: expiresAt.toISOString(),
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return created;
  });

  // Deliver the raw token through the development email channel only.
  await devEmailService.sendOrganizationInvitation(
    email,
    rawToken,
    access.organization.name,
    input.role,
  );

  const invitationRow: InvitationRow = {
    ...invitation,
    organization: access.organization,
    role: { id: roleId, name: input.role } as Role,
  };
  return invitationRow;
}

/**
 * Looks up an invitation by its (unauthenticated) raw token. The token is the
 * credential, so only its hash is ever used for lookup. Returns null for any
 * unknown token — callers must keep the error generic.
 */
export async function getInvitationByToken(
  rawToken: string,
): Promise<InvitationLookup | null> {
  const invitation = await prisma.organizationInvitation.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: {
      organization: true,
      role: true,
    },
  });
  if (!invitation) return null;
  return { invitation, state: invitationState(invitation) };
}

/**
 * Validates the token's state for the accept flow, mapping each terminal/non
 * terminal state to its stable AppError. Unknown tokens raise the generic
 * validation error (never revealing what went wrong).
 */
function assertAcceptableState(state: InvitationState | null): void {
  if (state === null) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  switch (state) {
    case "ACCEPTED":
      throw AppError.invitationAccepted();
    case "REVOKED":
      throw AppError.invitationRevoked();
    case "EXPIRED":
      throw AppError.invitationExpired();
    case "PENDING":
      return;
  }
}

/**
 * Accepts an invitation for the authenticated user. Guards:
 *  - the account's email (normalized) must match the invitation email,
 *  - the account must be email-verified,
 *  - the invitation must be pending (not accepted/revoked/expired).
 * Membership creation, invitation consumption, and the audit event are one
 * transaction. The membership is single-row per (organizationId, userId).
 */
export async function acceptInvitation(
  rawToken: string,
  actor: { userId: string; email: string; emailVerified: boolean },
  meta: RequestMeta,
): Promise<{
  membership: ReturnType<typeof toPublicMembership>;
  organization: Organization;
}> {
  const lookup = await getInvitationByToken(rawToken);
  if (!lookup) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  const { invitation } = lookup;
  assertAcceptableState(lookup.state);

  if (!actor.emailVerified) {
    throw AppError.forbidden(
      "Verify your email address before joining an organization.",
    );
  }
  if (normalizeEmail(actor.email) !== invitation.email) {
    throw AppError.forbidden(
      "This invitation was sent to a different email address.",
    );
  }

  const role = invitation.role;
  if (!role) {
    throw AppError.validation("Invalid or expired invitation.");
  }
  const organization = invitation.organization;
  if (!organization) {
    throw AppError.validation("Invalid or expired invitation.");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const now = new Date();
      const existing = await tx.organizationMember.findFirst({
        where: {
          organizationId: invitation.organizationId,
          userId: actor.userId,
        },
      });

      let membership;
      if (!existing) {
        membership = await tx.organizationMember.create({
          data: {
            organizationId: invitation.organizationId,
            userId: actor.userId,
            roleId: role.id,
            status: "ACTIVE",
            joinedAt: now,
            lastActiveAt: now,
          },
          include: { user: true, role: true },
        });
      } else if (existing.status === "ACTIVE") {
        throw new ConflictError(
          "User is already a member of this organization.",
        );
      } else if (existing.status === "SUSPENDED") {
        throw new ConflictError("User membership is currently suspended.");
      } else {
        membership = await tx.organizationMember.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            roleId: role.id,
            joinedAt: existing.joinedAt ?? now,
          },
          include: { user: true, role: true },
        });
      }

      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: now },
      });

      await writeSecurityEvent(tx, {
        type: SecurityEventType.MEMBER_JOINED,
        userId: actor.userId,
        organizationId: invitation.organizationId,
        metadata: {
          email: actor.email,
          role: role.name,
          invitationId: invitation.id,
          acceptedMembershipId: membership.id,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        membership: toPublicMembership(membership),
        organization,
      };
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      throw AppError.conflict(err.message);
    }
    if (
      err instanceof Error &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      throw AppError.conflict("You are already a member of this organization.");
    }
    throw err;
  }
}

/** Internal sentinel mapped to a CONFLICT outside the transaction. */
class ConflictError extends Error {}

/** Home does not leak the internal class; maps DB-level duplicate errors. */
export async function revokeInvitation(
  _access: OrgAccess,
  organizationId: string,
  invitationId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<InvitationRow> {
  const invitation = await prisma.organizationInvitation.findFirst({
    where: { id: invitationId, organizationId },
    include: {
      organization: true,
      role: true,
    },
  });
  if (!invitation) {
    throw AppError.notFound("Invitation not found.");
  }
  if (invitation.acceptedAt) {
    throw AppError.invitationAccepted();
  }
  if (invitation.revokedAt) {
    return invitation; // idempotent revoke
  }

  const revoked = await prisma.$transaction(async (tx) => {
    const updated = await tx.organizationInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
      include: {
        organization: true,
        role: true,
      },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.MEMBER_INVITATION_REVOKED,
      userId: actorUserId,
      organizationId,
      metadata: { email: invitation.email, invitationId: invitation.id },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return updated;
  });
  return revoked;
}

export { toPublicInvitation };
