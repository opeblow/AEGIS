import { z } from "zod";
import {
  DOCUMENT_TYPE_IDS,
  DOCUMENT_VISIBILITY_VALUES,
} from "./document-types.js";

// ---------------------------------------------------------------------------
// Documents (Phase 6) — Zod schemas
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

const documentTypeEnum = enumFrom(DOCUMENT_TYPE_IDS);

const visibilityEnum = enumFrom(DOCUMENT_VISIBILITY_VALUES);

function enumFrom<T extends string>(
  values: readonly T[],
): z.ZodEnum<[T, ...T[]]> {
  return z.enum(values as unknown as [T, ...T[]]);
}

export const dealIdParamsSchema = z
  .object({ dealId: uuidField("dealId") })
  .strict();

export const documentIdParamsSchema = z
  .object({
    dealId: uuidField("dealId"),
    documentId: uuidField("documentId"),
  })
  .strict();

const titleField = z
  .string()
  .trim()
  .min(1, "title must not be empty.")
  .max(200, "title must be at most 200 characters.");

const descriptionField = z
  .string()
  .trim()
  .max(2000, "description must be at most 2000 characters.");

const visibilityField = visibilityEnum;

function checkVisibility(
  body: {
    visibility?: string;
    visibleToOrganizationIds?: string[];
  },
  ctx: z.RefinementCtx,
): void {
  const specified = body.visibleToOrganizationIds;
  if (body.visibility === "SPECIFIC_PARTICIPANTS") {
    if (!specified || specified.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToOrganizationIds"],
        message:
          "visibleToOrganizationIds is required when visibility is SPECIFIC_PARTICIPANTS.",
      });
      return;
    }
    if (specified.length > 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToOrganizationIds"],
        message: "At most 20 organizations may be granted document access.",
      });
      return;
    }
    if (new Set(specified).size !== specified.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["visibleToOrganizationIds"],
        message: "visibleToOrganizationIds must not contain duplicates.",
      });
    }
  } else if (specified) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visibleToOrganizationIds"],
      message:
        "visibleToOrganizationIds is only valid when visibility is SPECIFIC_PARTICIPANTS.",
    });
  }
}

const visibleToOrganizationIdsField = z
  .array(uuidField("organizationId"))
  .max(20)
  .optional();

/** Create a document (UPLOADING). No bytes yet. */
export const createDocumentBodySchema = z
  .object({
    documentType: documentTypeEnum,
    title: titleField,
    description: descriptionField.optional(),
    visibility: visibilityField.default("PRIVATE"),
    visibleToOrganizationIds: visibleToOrganizationIdsField,
    idempotencyKey: idempotencyKeyField.optional(),
  })
  .strict()
  .superRefine(checkVisibility);

/** Start a replacement version of the current document chain. */
export const replaceDocumentBodySchema = z
  .object({
    documentType: documentTypeEnum.optional(),
    title: titleField.optional(),
    description: descriptionField.nullable().optional(),
    visibility: visibilityField.optional(),
    visibleToOrganizationIds: visibleToOrganizationIdsField,
    idempotencyKey: idempotencyKeyField.optional(),
    requestId: requestIdField.optional(),
  })
  .strict()
  .superRefine(checkVisibility);

export const submitDocumentBodySchema = z
  .object({ requestId: requestIdField.optional() })
  .strict();

export const withdrawDocumentBodySchema = z
  .object({ requestId: requestIdField.optional() })
  .strict();

export const completeDocumentBodySchema = z
  .object({ requestId: requestIdField.optional() })
  .strict();

export const reviewDocumentBodySchema = z
  .object({
    decision: z.enum(["ACCEPT", "REJECT"]),
    comment: z
      .string()
      .trim()
      .min(3, "comment must be at least 3 characters.")
      .max(1000, "comment must be at most 1000 characters.")
      .optional(),
    requestId: requestIdField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.decision === "REJECT" && !body.comment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["comment"],
        message: "A comment is required when rejecting a document.",
      });
    }
  });

export const documentQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum([
        "UPLOADING",
        "UPLOADED",
        "SUBMITTED",
        "UNDER_REVIEW",
        "ACCEPTED",
        "REJECTED",
        "EXPIRED",
        "WITHDRAWN",
        "SUPERSEDED",
      ])
      .optional(),
    visibility: visibilityEnum.optional(),
    documentType: documentTypeEnum.optional(),
  })
  .strict();

export type CreateDocumentBody = z.infer<typeof createDocumentBodySchema>;
export type ReplaceDocumentBody = z.infer<typeof replaceDocumentBodySchema>;
export type SubmitDocumentBody = z.infer<typeof submitDocumentBodySchema>;
export type WithdrawDocumentBody = z.infer<typeof withdrawDocumentBodySchema>;
export type CompleteDocumentBody = z.infer<typeof completeDocumentBodySchema>;
export type ReviewDocumentBody = z.infer<typeof reviewDocumentBodySchema>;
export type DocumentQuery = z.infer<typeof documentQuerySchema>;
export type DocumentParams = z.infer<typeof documentIdParamsSchema>;
export type DealIdParams = z.infer<typeof dealIdParamsSchema>;
