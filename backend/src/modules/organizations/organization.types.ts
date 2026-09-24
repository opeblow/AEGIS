import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  Permission,
  Role,
  User,
} from "@prisma/client";

/** Public, client-safe organization representation. */
export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  country: string | null;
  timezone: string | null;
  status: Organization["status"];
  createdAt: Date;
  updatedAt: Date;
}

/** Public role summary (name + permissions where needed). */
export interface PublicRoleSummary {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
}

export interface PublicRoleDetail extends PublicRoleSummary {
  permissions: string[];
}

/** Public, client-safe membership representation (never raw credentials). */
export interface PublicMembership {
  id: string;
  organizationId: string;
  user: {
    id: string;
    email: string;
    emailVerified: boolean;
  };
  role: PublicRoleSummary;
  status: OrganizationMember["status"];
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InvitationState = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

/** Public invitation representation. Never contains the raw token. */
export interface PublicInvitation {
  id: string;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  email: string;
  role: PublicRoleSummary;
  state: InvitationState;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export function toPublicOrganization(org: Organization): PublicOrganization {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    legalName: org.legalName,
    country: org.country,
    timezone: org.timezone,
    status: org.status,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
  };
}

export function toPublicRoleSummary(
  role: Role | null | undefined,
): PublicRoleSummary {
  if (!role) {
    return { id: "", name: "UNKNOWN", description: null, isSystem: false };
  }
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
  };
}

/** Public role detail: summary + resolved permission names. */
export function toPublicRoleDetail(
  role: (Role | null | undefined) & {
    permissions?: Array<{ permission: Permission }>;
  },
): PublicRoleDetail {
  return {
    ...toPublicRoleSummary(role),
    permissions: (role?.permissions ?? [])
      .map((rp) => rp.permission.name)
      .sort(),
  };
}

export function toPublicMembership(
  membership: OrganizationMember & {
    user?: Pick<User, "id" | "email" | "emailVerifiedAt">;
    role?: Role | null;
  },
): PublicMembership {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    user: {
      id: membership.user?.id ?? "",
      email: membership.user?.email ?? "",
      emailVerified: membership.user
        ? membership.user.emailVerifiedAt !== null
        : false,
    },
    role: toPublicRoleSummary(membership.role),
    status: membership.status,
    joinedAt: membership.joinedAt,
    lastActiveAt: membership.lastActiveAt,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

export function invitationState(
  invitation: Pick<
    OrganizationInvitation,
    "acceptedAt" | "revokedAt" | "expiresAt"
  >,
): InvitationState {
  if (invitation.acceptedAt) return "ACCEPTED";
  if (invitation.revokedAt) return "REVOKED";
  if (Date.now() > invitation.expiresAt.getTime()) return "EXPIRED";
  return "PENDING";
}

export function toPublicInvitation(
  invitation: OrganizationInvitation & {
    organization?: Organization | null;
    role?: Role | null;
  },
): PublicInvitation {
  return {
    id: invitation.id,
    organization: invitation.organization ?? {
      id: invitation.organizationId,
      name: "unknown",
      slug: "unknown",
    },
    email: invitation.email,
    role: toPublicRoleSummary(invitation.role),
    state: invitationState(invitation),
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt,
    revokedAt: invitation.revokedAt,
  };
}
