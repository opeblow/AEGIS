import { z } from "zod";
import { emailSchema, token256Schema } from "../auth/schemas.js";
import { SystemRole } from "./roles.js";

/** Slug pattern: lowercase alphanumerics + hyphens, no leading/trailing hyphen. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const organizationNameSchema = z
  .string()
  .trim()
  .min(1, { message: "Organization name is required." })
  .max(200, { message: "Organization name is too long." });

export const slugInputSchema = z
  .string()
  .trim()
  .min(1, { message: "Slug is required." })
  .max(80, { message: "Slug is too long." });

export const roleNameSchema = z.enum([
  SystemRole.Owner,
  SystemRole.Admin,
  SystemRole.Member,
  SystemRole.Viewer,
]);

export const uuidParamSchema = z.object({
  organizationId: z
    .string()
    .trim()
    .uuid({ message: "Invalid organization id." }),
});

export const memberUuidParamSchema = uuidParamSchema.extend({
  memberId: z.string().trim().uuid({ message: "Invalid member id." }),
});

export const invitationUuidParamSchema = uuidParamSchema.extend({
  invitationId: z.string().trim().uuid({ message: "Invalid invitation id." }),
});

export const invitationTokenParamSchema = z.object({
  token: token256Schema,
});

export const createOrganizationBodySchema = z.object({
  name: organizationNameSchema,
  slug: slugInputSchema.optional(),
  legalName: z
    .string()
    .trim()
    .max(200, { message: "Legal name is too long." })
    .optional()
    .or(z.literal("")),
  country: z
    .string()
    .trim()
    .max(64, { message: "Country is too long." })
    .optional()
    .or(z.literal("")),
  timezone: z
    .string()
    .trim()
    .max(64, { message: "Timezone is too long." })
    .optional()
    .or(z.literal("")),
});

export const updateOrganizationBodySchema = z
  .object({
    name: organizationNameSchema.optional(),
    slug: slugInputSchema.optional(),
    legalName: z
      .string()
      .trim()
      .max(200, { message: "Legal name is too long." })
      .optional()
      .or(z.literal("")),
    country: z
      .string()
      .trim()
      .max(64, { message: "Country is too long." })
      .optional()
      .or(z.literal("")),
    timezone: z
      .string()
      .trim()
      .max(64, { message: "Timezone is too long." })
      .optional()
      .or(z.literal("")),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided to update the organization.",
  });

export const createInvitationBodySchema = z.object({
  email: emailSchema,
  role: roleNameSchema,
});

export const updateMemberStatusBodySchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
});

export const changeMemberRoleBodySchema = z.object({
  role: roleNameSchema,
});

export const transferOwnershipBodySchema = z.object({
  memberId: z.string().trim().uuid({ message: "Invalid member id." }),
});

export const securityEventsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1, { message: "limit must be at least 1." })
    .max(100, { message: "limit must be at most 100." })
    .default(50),
  offset: z.coerce
    .number()
    .int()
    .min(0, { message: "offset must be at least 0." })
    .default(0),
});

export type CreateOrganizationBody = z.infer<
  typeof createOrganizationBodySchema
>;
export type UpdateOrganizationBody = z.infer<
  typeof updateOrganizationBodySchema
>;
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;
export type UpdateMemberStatusBody = z.infer<
  typeof updateMemberStatusBodySchema
>;
export type ChangeMemberRoleBody = z.infer<typeof changeMemberRoleBodySchema>;
export type TransferOwnershipBody = z.infer<typeof transferOwnershipBodySchema>;
export type SecurityEventsQuery = z.infer<typeof securityEventsQuerySchema>;
