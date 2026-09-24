import { z } from "zod";

// ---------------------------------------------------------------------------
// Deal requirements (Phase 6) — Zod schemas
// ---------------------------------------------------------------------------

const uuidField = (label: string) =>
  z.string().trim().uuid(`${label} must be a valid UUID.`);

const requestIdField = z
  .string()
  .min(8, "requestId must be at least 8 characters.")
  .max(128, "requestId must be at most 128 characters.");

const idempotencyKeyField = z
  .string()
  .min(8, "idempotencyKey must be at least 8 characters.")
  .max(128, "idempotencyKey must be at most 128 characters.");

const datetimeField = (label = "Date") =>
  z.coerce.date().refine((date) => !Number.isNaN(date.getTime()), {
    message: `${label} must be a valid date-time.`,
  });

export const dealIdParamsSchema = z
  .object({ dealId: uuidField("dealId") })
  .strict();

export const requirementIdParamsSchema = z
  .object({
    dealId: uuidField("dealId"),
    requirementId: uuidField("requirementId"),
  })
  .strict();

export const REQUIREMENT_TYPES = [
  "DOCUMENT",
  "INFORMATION",
  "CONFIRMATION",
] as const;

export type RequirementTypeValue = (typeof REQUIREMENT_TYPES)[number];

/** Create a requirement. `organizationId` on the row is always the deal owner
 *  (the creator); `assignedOrganizationId` optionally targets a participant. */
export const createRequirementBodySchema = z
  .object({
    requirementType: z.enum(REQUIREMENT_TYPES),
    title: z
      .string()
      .trim()
      .min(1, "title must not be empty.")
      .max(200, "title must be at most 200 characters."),
    description: z
      .string()
      .trim()
      .max(2000, "description must be at most 2000 characters.")
      .optional(),
    assignedOrganizationId: uuidField("assignedOrganizationId").optional(),
    required: z.boolean().default(true),
    dueAt: datetimeField("dueAt").optional(),
    idempotencyKey: idempotencyKeyField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.dueAt && body.dueAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["dueAt"],
        message: "dueAt must be in the future.",
      });
    }
  });

export const submitRequirementBodySchema = z
  .object({ requestId: requestIdField.optional() })
  .strict();

export const rejectRequirementBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, "reason must be at least 3 characters.")
      .max(1000, "reason must be at most 1000 characters."),
    requestId: requestIdField.optional(),
  })
  .strict();

export const waiveRequirementBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(1000, "reason must be at most 1000 characters.")
      .optional(),
    requestId: requestIdField.optional(),
  })
  .strict();

export const reopenRequirementBodySchema = z
  .object({ requestId: requestIdField.optional() })
  .strict();

export const satisfyRequirementBodySchema = z
  .object({
    comment: z
      .string()
      .trim()
      .max(1000, "comment must be at most 1000 characters.")
      .optional(),
    requestId: requestIdField.optional(),
  })
  .strict();

export const attachRequirementDocumentBodySchema = z
  .object({
    documentId: uuidField("documentId"),
  })
  .strict();

export const requirementQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum(["OPEN", "SUBMITTED", "SATISFIED", "REJECTED", "WAIVED", "EXPIRED"])
      .optional(),
    required: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    assignedOrganizationId: uuidField("assignedOrganizationId").optional(),
  })
  .strict();

export type CreateRequirementBody = z.infer<typeof createRequirementBodySchema>;
export type SubmitRequirementBody = z.infer<typeof submitRequirementBodySchema>;
export type RejectRequirementBody = z.infer<typeof rejectRequirementBodySchema>;
export type WaiveRequirementBody = z.infer<typeof waiveRequirementBodySchema>;
export type ReopenRequirementBody = z.infer<typeof reopenRequirementBodySchema>;
export type SatisfyRequirementBody = z.infer<
  typeof satisfyRequirementBodySchema
>;
export type AttachRequirementDocumentBody = z.infer<
  typeof attachRequirementDocumentBodySchema
>;
export type RequirementQuery = z.infer<typeof requirementQuerySchema>;
export type RequirementParams = z.infer<typeof requirementIdParamsSchema>;
export type DealIdParams = z.infer<typeof dealIdParamsSchema>;
