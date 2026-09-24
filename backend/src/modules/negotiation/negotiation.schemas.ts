import { z } from "zod";
import { AppError } from "../../lib/errors/index.js";
import {
  assertMoneyForCurrency,
  currencyField,
  moneyString,
} from "../deals/deal.schemas.js";
import { type OfferStatus, OFFER_STATUSES } from "./offer-state.js";

// ---------------------------------------------------------------------------
// Shared fields
// ---------------------------------------------------------------------------

const datetimeField = (label = "Date") =>
  z.coerce.date().refine((date) => !Number.isNaN(date.getTime()), {
    message: `${label} must be a valid date-time.`,
  });

const versionField = z.coerce.number().int().min(1);

const requestIdField = z
  .string()
  .min(8, "requestId must be at least 8 characters.")
  .max(128, "requestId must be at most 128 characters.");

const idempotencyKeyField = z
  .string()
  .min(8, "idempotencyKey must be at least 8 characters.")
  .max(128, "idempotencyKey must be at most 128 characters.");

const invitationTokenField = z
  .string()
  .trim()
  .min(8, "token is invalid")
  .max(128, "token is invalid");

export const DEAL_PARTICIPANT_TYPES = ["COUNTERPARTY", "OBSERVER"] as const;

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const dealIdParamsSchema = z
  .object({ dealId: z.string().trim().uuid("dealId must be a valid UUID.") })
  .strict();

export const offerIdParamsSchema = z
  .object({
    dealId: z.string().trim().uuid("dealId must be a valid UUID."),
    offerId: z.string().trim().uuid("offerId must be a valid UUID."),
  })
  .strict();

export const participantIdParamsSchema = z
  .object({
    dealId: z.string().trim().uuid("dealId must be a valid UUID."),
    participantId: z
      .string()
      .trim()
      .uuid("participantId must be a valid UUID."),
  })
  .strict();

export const invitationIdParamsSchema = z
  .object({
    dealId: z.string().trim().uuid("dealId must be a valid UUID."),
    invitationId: z.string().trim().uuid("invitationId must be a valid UUID."),
  })
  .strict();

export const dealInvitationTokenParamsSchema = z
  .object({ token: invitationTokenField })
  .strict();

/** { organizationId } for the org-scoped counterparty route family. */
export const organizationCounterpartyIdParamsSchema = z
  .object({
    organizationId: z
      .string()
      .trim()
      .uuid("organizationId must be a valid UUID."),
  })
  .strict();

/** { organizationId, counterpartyId } for counterparty item routes. */
export const counterpartyIdParamsSchema = z
  .object({
    organizationId: z
      .string()
      .trim()
      .uuid("organizationId must be a valid UUID."),
    counterpartyId: z
      .string()
      .trim()
      .uuid("counterpartyId must be a valid UUID."),
  })
  .strict();

// ---------------------------------------------------------------------------
// Counterparty (org-scoped)
// ---------------------------------------------------------------------------

export const counterpartyCreateBodySchema = z
  .object({
    counterpartyOrganizationId: z
      .string()
      .trim()
      .uuid("counterpartyOrganizationId must be a valid UUID."),
  })
  .strict();

export const counterpartyUpdateBodySchema = z
  .object({
    status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"]).optional(),
    verificationStatus: z
      .enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"])
      .optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.verificationStatus !== undefined, {
    message: "Provide status and/or verificationStatus to update.",
  });

export const counterpartyQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REVOKED"]).optional(),
    verificationStatus: z
      .enum(["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"])
      .optional(),
    direction: z.enum(["outgoing", "incoming"]).optional(),
    search: z
      .string()
      .trim()
      .min(1, "search must not be empty.")
      .max(100, "search must be at most 100 characters.")
      .optional(),
  })
  .strict();

export type CounterpartyCreateBody = z.infer<
  typeof counterpartyCreateBodySchema
>;
export type CounterpartyUpdateBody = z.infer<
  typeof counterpartyUpdateBodySchema
>;
export type CounterpartyQuery = z.infer<typeof counterpartyQuerySchema>;

// ---------------------------------------------------------------------------
// Participants & invitations
// ---------------------------------------------------------------------------

export const inviteParticipantBodySchema = z
  .object({
    organizationId: z
      .string()
      .trim()
      .uuid("organizationId must be a valid UUID."),
    email: z.string().trim().email("email must be a valid email address."),
    participantType: z.enum(DEAL_PARTICIPANT_TYPES).default("COUNTERPARTY"),
  })
  .strict();

export const participantStatusBodySchema = z
  .object({
    status: z.enum(["SUSPENDED", "REACTIVATED", "REMOVED"]),
    version: versionField,
    requestId: requestIdField.optional(),
  })
  .strict();

export const offerQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: z
      .enum(OFFER_STATUSES as unknown as [OfferStatus, ...OfferStatus[]])
      .optional(),
  })
  .strict();

export const negotiationQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();

export type InviteParticipantBody = z.infer<typeof inviteParticipantBodySchema>;
export type ParticipantStatusBody = z.infer<typeof participantStatusBodySchema>;
export type OfferQuery = z.infer<typeof offerQuerySchema>;
export type NegotiationQuery = z.infer<typeof negotiationQuerySchema>;

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

/** Validates money/currency/deadline constraints for an offer term body. */
function offerTermCheck(
  body: {
    currency: string;
    amount: string;
    price?: string | null;
    settlementDate?: Date | null;
    expiresAt?: Date | null;
  },
  ctx: z.RefinementCtx,
  currency: string,
  now: number,
): void {
  for (const field of ["amount", "price"] as const) {
    const value = body[field];
    if (value === undefined || value === null) continue;
    try {
      assertMoneyForCurrency(value, body.currency ?? currency);
    } catch (err) {
      if (err instanceof AppError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: err.message,
        });
      }
      return;
    }
  }
  if (body.expiresAt && body.expiresAt.getTime() <= now) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be in the future.",
    });
  }
  if (
    body.expiresAt &&
    body.settlementDate &&
    body.expiresAt.getTime() >= body.settlementDate.getTime()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expiresAt"],
      message: "expiresAt must be before settlementDate.",
    });
  }
}

const offerTermFields = {
  currency: currencyField,
  amount: moneyString("amount"),
  price: moneyString("price").nullable().optional(),
  settlementDate: datetimeField("settlementDate").nullable().optional(),
  expiresAt: datetimeField("expiresAt").nullable().optional(),
};

/** Term fields shared by direct offers and counteroffers. */
export const offerTermBodySchema = z
  .object({
    ...offerTermFields,
    idempotencyKey: idempotencyKeyField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    offerTermCheck(body, ctx, body.currency, Date.now());
  });

/** Direct offer: requires the recipient participant and an idempotency key. */
export const createOfferBodySchema = z
  .object({
    ...offerTermFields,
    recipientParticipantId: z
      .string()
      .trim()
      .uuid("recipientParticipantId must be a valid UUID."),
    idempotencyKey: idempotencyKeyField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    offerTermCheck(body, ctx, body.currency, Date.now());
  });

const offerActionBody = {
  version: versionField,
  requestId: requestIdField,
};

/** Counteroffer: new child terms + the parent offer's optimistic lock. */
export const counterOfferBodySchema = z
  .object({
    ...offerTermFields,
    ...offerActionBody,
    idempotencyKey: idempotencyKeyField.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    offerTermCheck(body, ctx, body.currency, Date.now());
  });

export const submitOfferBodySchema = z.object(offerActionBody).strict();
export const acceptOfferBodySchema = z
  .object({
    ...offerActionBody,
    reason: z
      .string()
      .trim()
      .min(3, "reason must be at least 3 characters.")
      .max(500, "reason must be at most 500 characters.")
      .optional(),
  })
  .strict();
export const withdrawOfferBodySchema = z.object(offerActionBody).strict();
export const rejectOfferBodySchema = z
  .object({
    ...offerActionBody,
    reason: z
      .string()
      .trim()
      .min(3, "reason must be at least 3 characters.")
      .max(500, "reason must be at most 500 characters."),
  })
  .strict();

export type OfferTermBody = z.infer<typeof offerTermBodySchema>;
export type CreateOfferBody = z.infer<typeof createOfferBodySchema>;
export type CounterOfferBody = z.infer<typeof counterOfferBodySchema>;
export type SubmitOfferBody = z.infer<typeof submitOfferBodySchema>;
export type AcceptOfferBody = z.infer<typeof acceptOfferBodySchema>;
export type RejectOfferBody = z.infer<typeof rejectOfferBodySchema>;
export type WithdrawOfferBody = z.infer<typeof withdrawOfferBodySchema>;
export type ParticipantStatus = z.infer<
  typeof participantStatusBodySchema
>["status"];
