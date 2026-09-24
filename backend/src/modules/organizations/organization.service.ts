import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import {
  SLUG_PATTERN,
  type CreateOrganizationBody,
  type UpdateOrganizationBody,
} from "./organization.schemas.js";
import {
  toPublicMembership,
  toPublicOrganization,
  type PublicOrganization,
} from "./organization.types.js";
import { systemRoleId } from "./role.seed.js";
import { SystemRole } from "./roles.js";
import {
  writeSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import type { OrgAccess } from "./authorization.service.js";

export interface RequestMeta {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Max slug length (including implicit lowercase normalization). */
export const SLUG_MAX_LENGTH = 63;

/** Normalizes user-supplied text in a consistent, display-safe way. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Slugifies arbitrary input into the canonical slug form: lowercase
 * alphanumerics and hyphens, no leading/trailing hyphen, max 63 chars.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH);
}

function validateSlugOrThrow(slug: string): void {
  if (!slug || !SLUG_PATTERN.test(slug)) {
    throw AppError.validation(
      "Slug must contain only lowercase letters, numbers, and single hyphens.",
    );
  }
}

export interface CreatedOrganization {
  organization: PublicOrganization;
  membership: ReturnType<typeof toPublicMembership>;
}

/**
 * Creates an organization and the initial OWNER membership atomically. If any
 * step fails, the whole transaction rolls back.
 */
export async function createOrganization(
  creatorUserId: string,
  input: CreateOrganizationBody,
  meta: RequestMeta,
): Promise<CreatedOrganization> {
  const ownerRoleId = await systemRoleId(SystemRole.Owner);
  if (!ownerRoleId) {
    throw new Error("System roles are not seeded. Run npm run db:seed.");
  }

  const name = normalizeName(input.name);
  if (!name) throw AppError.validation("Organization name is required.");

  const base = {
    legalName: input.legalName ? input.legalName : null,
    country: input.country ? input.country : null,
    timezone: input.timezone ? input.timezone : null,
  };

  if (input.slug) {
    const slug = slugify(input.slug);
    validateSlugOrThrow(slug);
    try {
      return await createOrganizationTx(
        creatorUserId,
        name,
        slug,
        base,
        ownerRoleId,
        meta,
      );
    } catch (err) {
      if (isUniqueViolation(err, "Organization", "slug")) {
        throw AppError.conflict(
          "An organization with this slug already exists.",
        );
      }
      throw err;
    }
  }

  // Auto-derived slug from the name; append a deterministic suffix on collision.
  const baseSlug = slugify(name);
  validateSlugOrThrow(baseSlug);
  const candidateSlugs = [baseSlug];
  for (let i = 2; i <= 20; i += 1) candidateSlugs.push(`${baseSlug}-${i}`);
  for (let attempt = 0; attempt < candidateSlugs.length; attempt += 1) {
    const slug = candidateSlugs[attempt];
    try {
      return await createOrganizationTx(
        creatorUserId,
        name,
        slug,
        base,
        ownerRoleId,
        meta,
      );
    } catch (err) {
      if (isUniqueViolation(err, "Organization", "slug")) continue;
      throw err;
    }
  }
  // Extremely unlikely: all 20 suffix variants taken.
  throw AppError.conflict(
    "Could not allocate a unique slug. Try an explicit slug.",
  );
}

async function createOrganizationTx(
  creatorUserId: string,
  name: string,
  slug: string,
  info: {
    legalName: string | null;
    country: string | null;
    timezone: string | null;
  },
  ownerRoleId: string,
  meta: RequestMeta,
): Promise<CreatedOrganization> {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const organization = await tx.organization.create({
      data: {
        name,
        slug,
        legalName: info.legalName,
        country: info.country,
        timezone: info.timezone,
        status: "ACTIVE",
      },
    });
    const membershipRow = await tx.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: creatorUserId,
        roleId: ownerRoleId,
        status: "ACTIVE",
        joinedAt: now,
        lastActiveAt: now,
      },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.ORGANIZATION_CREATED,
      userId: creatorUserId,
      organizationId: organization.id,
      metadata: { name, slug },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    const membership = await tx.organizationMember.findUnique({
      where: { id: membershipRow.id },
      include: { role: true },
    });
    return {
      organization,
      membership: toPublicMembership(membership ?? membershipRow),
    };
  });
}

/** Organizations the user has an ACTIVE membership in, with role detail. */
export async function listOrganizationsForUser(userId: string) {
  const memberships = await prisma.organizationMember.findMany({
    where: { userId, status: "ACTIVE" },
    include: { organization: true, role: true },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    ...toPublicOrganization(m.organization),
    membership: {
      id: m.id,
      status: m.status,
      joinedAt: m.joinedAt,
      lastActiveAt: m.lastActiveAt,
      role: { id: m.role?.id ?? "", name: m.role?.name ?? "UNKNOWN" },
    },
  }));
}

/**
 * Updates organization metadata. Only safe display fields are writable here —
 * owner, members, roles, status, and permissions have dedicated flows.
 */
export async function updateOrganization(
  access: OrgAccess,
  input: UpdateOrganizationBody,
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicOrganization> {
  const org = access.organization;
  const data: {
    name?: string;
    slug?: string;
    legalName?: string | null;
    country?: string | null;
    timezone?: string | null;
  } = {};

  const changed: string[] = [];
  if (input.name !== undefined) {
    const name = normalizeName(input.name);
    if (!name) throw AppError.validation("Organization name is required.");
    if (name !== org.name) {
      data.name = name;
      changed.push("name");
    }
  }
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    validateSlugOrThrow(slug);
    if (slug !== org.slug) {
      data.slug = slug;
      changed.push("slug");
    }
  }
  if (
    input.legalName !== undefined &&
    (input.legalName || null) !== org.legalName
  ) {
    data.legalName = input.legalName || null;
    changed.push("legalName");
  }
  if (input.country !== undefined && (input.country || null) !== org.country) {
    data.country = input.country || null;
    changed.push("country");
  }
  if (
    input.timezone !== undefined &&
    (input.timezone || null) !== org.timezone
  ) {
    data.timezone = input.timezone || null;
    changed.push("timezone");
  }

  if (changed.length === 0) {
    return org;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id: org.id },
        data,
      });
      await writeSecurityEvent(tx, {
        type: SecurityEventType.ORGANIZATION_UPDATED,
        userId: actorUserId,
        organizationId: org.id,
        metadata: { changed },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err, "Organization", "slug")) {
      throw AppError.conflict("An organization with this slug already exists.");
    }
    throw err;
  }
}

function isUniqueViolation(
  err: unknown,
  _model: string,
  field: string,
): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta?.target as string[]).includes(field)
  );
}
