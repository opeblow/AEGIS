import { z } from "zod";
import { AppError } from "../../lib/errors/index.js";
import { DEAL_STATUSES, DEAL_TYPES } from "./deal-state.js";

// ---------------------------------------------------------------------------
// ISO 4217 money
// ---------------------------------------------------------------------------

/**
 * ISO 4217 currency catalog: code -> { minor, symbol }.
 *
 * The whole money path is built on this catalog:
 *   - `currency` is always a valid ISO 4217 alpha-3 code.
 *   - `notionalAmount` precision is validated AGAINST the catalog entry
 *     (minor units), so a client can never smuggle in more precision than the
 *     currency allows (a "reject, don't round" money policy).
 *   - Money is transported as a STRING on the wire and stored as Decimal in
 *     the DB — never as a JS float.
 *
 * Tokenized-asset identifiers are deliberately NOT modeled here in Phase 4:
 * they arrive in a later asset phase with their own precision rules. The
 * catalog is the swap point for that model.
 */
const ISO_4217: Readonly<Record<string, { minor: number; symbol: string }>> = {
  USD: { minor: 2, symbol: "$" },
  EUR: { minor: 2, symbol: "€" },
  GBP: { minor: 2, symbol: "£" },
  JPY: { minor: 0, symbol: "¥" },
  CHF: { minor: 2, symbol: "CHF" },
  CAD: { minor: 2, symbol: "CA$" },
  AUD: { minor: 2, symbol: "A$" },
  SGD: { minor: 2, symbol: "S$" },
  HKD: { minor: 2, symbol: "HK$" },
  CNY: { minor: 2, symbol: "CN¥" },
  NGN: { minor: 2, symbol: "₦" },
  GHS: { minor: 2, symbol: "GH₵" },
  ZAR: { minor: 2, symbol: "R" },
  XAF: { minor: 0, symbol: "FCFA" },
  XOF: { minor: 0, symbol: "FCFA" },
  KES: { minor: 2, symbol: "KSh" },
};

/** Alpha-3 codes whose minor-unit precision we are willing to represent. */
export const ISO_4217_CODES = new Set(Object.keys(ISO_4217));

export type CurrencyCode = keyof typeof ISO_4217;

/**
 * A non-negative decimal string, e.g. "1234.56". Whole + up to 8 fraction
 * digits — the DB column is DECIMAL(28,8). The per-currency precision check
 * (≤ the currency's minor units) is layered on top, so "1.5" is valid for
 * USD only up to 2 places, "1.500" is rejected, etc.
 */
const MONEY_PATTERN = /^\d{1,20}(\.\d{1,8})?$/;

export function isKnownCurrency(code: string): boolean {
  return ISO_4217_CODES.has(code);
}

/**
 * Resolves a currency to its minor-unit precision + display symbol. Throws a
 * client-safe `INVALID_CURRENCY` AppError for unknown codes so callers can
 * never persist an unvalidated currency string.
 */
export function currencyInfo(code: string): { minor: number; symbol: string } {
  const info = ISO_4217[code];
  if (!info) {
    throw AppError.invalidCurrency(`Unsupported or unknown currency: ${code}`);
  }
  return info;
}

/** Number of fractional digits in a money string (0 when there is no point). */
export function moneyFractionDigits(value: string): number {
  const dot = value.indexOf(".");
  return dot === -1 ? 0 : value.length - dot - 1;
}

/** True when every digit in the money string is '0' (i.e. the amount is 0). */
export function isZeroMoney(value: string): boolean {
  if (!MONEY_PATTERN.test(value)) return false;
  return value.split("").every((ch) => ch === "0" || ch === ".");
}

/**
 * Throws when `value` is not a valid positive money string for `currency`.
 *
 *   - amount must be > 0
 *   - fraction digits must not exceed the currency's minor units
 *
 * This is the canonical "reject, don't round" gate used by both the schema
 * layer and the service layer (when a currency change must re-validate the
 * existing notional amount).
 */
export function assertMoneyForCurrency(value: string, currency: string): void {
  if (!MONEY_PATTERN.test(value)) {
    throw AppError.invalidMoneyAmount(
      "Amount must be a non-negative decimal string.",
    );
  }
  if (isZeroMoney(value)) {
    throw AppError.invalidMoneyAmount("Amount must be greater than zero.");
  }
  const info = currencyInfo(currency);
  if (moneyFractionDigits(value) > info.minor) {
    throw AppError.invalidMoneyAmount(
      `${currency} allows at most ${info.minor} decimal places; received ${moneyFractionDigits(value)}.`,
    );
  }
}

/** Money as a non-negative decimal string (up to 8 fraction digits). */
export const moneyString = (label = "Money") =>
  z
    .string()
    .regex(MONEY_PATTERN, `${label} must be a non-negative decimal string.`)
    .refine((value) => !isZeroMoney(value), {
      message: `${label} must be greater than zero.`,
    });

/** 3-letter ISO 4217 code, validated against the catalog. */
export const currencyField = z
  .string()
  .min(3)
  .max(3)
  .refine((code) => isKnownCurrency(code), "Unknown ISO 4217 currency code.");

/** A valid date-time. `z.coerce.date()` accepts Invalid Dates; we do not. */
const datetimeField = (label = "Date") =>
  z.coerce.date().refine((date) => !Number.isNaN(date.getTime()), {
    message: `${label} must be a valid date-time.`,
  });

/** Structured-but-flexible metadata, bounded in size to prevent abuse. */
const metadataField = z
  .record(z.string(), z.unknown())
  .refine((value) => Object.keys(value).length <= 50, {
    message: "metadata must have at most 50 keys.",
  });

// ---------------------------------------------------------------------------
// Deal lifecycle (Phase 4)
// ---------------------------------------------------------------------------

/** Client-supplied reference format (server generates one when omitted). */
export const DEAL_REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const dealReferenceField = z
  .string()
  .trim()
  .min(1, "reference must not be empty.")
  .max(64, "reference must be at most 64 characters.")
  .regex(
    DEAL_REFERENCE_PATTERN,
    "reference may contain letters, digits, '.', '_' and '-'.",
  );

export const dealTypeField = z.enum(DEAL_TYPES);

export const dealStatusField = z.enum(DEAL_STATUSES);

export const dealUuidParamsSchema = z
  .object({
    organizationId: z
      .string()
      .trim()
      .uuid("organizationId must be a valid UUID."),
    dealId: z.string().trim().uuid("dealId must be a valid UUID."),
  })
  .strict();

/** Query filters for listing deals within an organization. */
export const dealQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100000).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    status: dealStatusField.optional(),
    type: dealTypeField.optional(),
    search: z
      .string()
      .trim()
      .min(1, "search must not be empty.")
      .max(100, "search must be at most 100 characters.")
      .optional(),
    createdFrom: datetimeField("createdFrom").optional(),
    createdTo: datetimeField("createdTo").optional(),
    sort: z.enum(["createdAt", "name", "reference"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict()
  .refine(
    (query) =>
      query.createdFrom === undefined ||
      query.createdTo === undefined ||
      query.createdFrom.getTime() <= query.createdTo.getTime(),
    { message: "createdFrom must be before or equal to createdTo." },
  );

/**
 * Create a deal (DRAFT). Money arrives as a string, never a float; `currency`
 * is validated against the ISO 4217 catalog; the notional amount must be
 * positive and within the currency's precision. The organization is taken
 * from the URL path — the body carries no organizationId (no org tampering
 * surface). `reference` is optional; the server generates a collision-safe
 * one when omitted.
 */
export const createDealBodySchema = z
  .object({
    type: dealTypeField,
    name: z
      .string()
      .trim()
      .min(1, "name must not be empty.")
      .max(200, "name must be at most 200 characters."),
    description: z
      .string()
      .trim()
      .max(2000, "description must be at most 2000 characters.")
      .optional(),
    currency: currencyField,
    notionalAmount: moneyString("notionalAmount"),
    settlementDate: datetimeField("settlementDate").optional(),
    expiresAt: datetimeField("expiresAt").optional(),
    reference: dealReferenceField.optional(),
    metadata: metadataField.optional(),
    /**
     * Idempotency (create): a retried request with the same key returns the
     * originally created deal rather than creating a duplicate. Stored as a
     * SHA-256 hash; the caller should treat the key as a secret handle.
     */
    idempotencyKey: z
      .string()
      .min(8, "idempotencyKey must be at least 8 characters.")
      .max(128, "idempotencyKey must be at most 128 characters.")
      .optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    // Money: reject precision beyond the currency's minor units at the boundary.
    try {
      assertMoneyForCurrency(body.notionalAmount, body.currency);
    } catch (err) {
      if (err instanceof AppError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["notionalAmount"],
          message: err.message,
        });
      }
      return;
    }
    // Deadlines: an expiresAt in the past would expire a deal immediately.
    if (body.expiresAt && body.expiresAt.getTime() <= Date.now()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expiresAt"],
        message: "expiresAt must be in the future.",
      });
    }
    // A deal must never "expire" after it is scheduled to settle.
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
  });

/**
 * Update a deal. ONLY presentation/term fields are editable here — status,
 * state history, ownership, organization, and settlement fields have
 * dedicated flows. `version` is REQUIRED (optimistic concurrency): a stale
 * write gets 409, never a silent clobber.
 */
export const updateDealBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "name must not be empty.")
      .max(200, "name must be at most 200 characters.")
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, "description must be at most 2000 characters.")
      .nullable()
      .optional(),
    type: dealTypeField.optional(),
    currency: currencyField.optional(),
    notionalAmount: moneyString("notionalAmount").optional(),
    settlementDate: datetimeField("settlementDate").nullable().optional(),
    expiresAt: datetimeField("expiresAt").nullable().optional(),
    metadata: metadataField.optional(),
    version: z.coerce.number().int().min(1),
  })
  .strict()
  .superRefine((body, ctx) => {
    // When both change together, validate the pair at the boundary.
    if (body.currency !== undefined && body.notionalAmount !== undefined) {
      try {
        assertMoneyForCurrency(body.notionalAmount, body.currency);
      } catch (err) {
        if (err instanceof AppError) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["notionalAmount"],
            message: err.message,
          });
        }
      }
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
  });

/**
 * Advance a deal through its state machine. The ONLY way status changes —
 * clients may not write status directly. Every mutation routes through the
 * validated transition table in deal-state.ts. `requestId` is the server-side
 * idempotency key: replaying the same requestId + toStatus returns the
 * original transition; a different toStatus under the same requestId is
 * rejected. Cancellation is a transition to `CANCELLED` and requires a reason.
 */
export const transitionDealBodySchema = z
  .object({
    toStatus: dealStatusField,
    reason: z
      .string()
      .trim()
      .min(3, "reason must be at least 3 characters.")
      .max(500, "reason must be at most 500 characters.")
      .optional(),
    metadata: metadataField.optional(),
    version: z.coerce.number().int().min(1),
    requestId: z
      .string()
      .min(8, "requestId must be at least 8 characters.")
      .max(128, "requestId must be at most 128 characters."),
  })
  .strict()
  .superRefine((body, ctx) => {
    // Machine-driven significant moves deserve an auditable reason.
    if (
      body.toStatus === "CANCELLED" ||
      body.toStatus === "FAILED" ||
      body.toStatus === "DISPUTED" ||
      body.toStatus === "EXPIRED"
    ) {
      if (!body.reason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reason"],
          message: `A reason is required when transitioning to ${body.toStatus}.`,
        });
      }
    }
  });

/** Bounded, deterministic history pagination. */
export const dealHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(10000).default(0),
  })
  .strict();

export type DealQuery = z.infer<typeof dealQuerySchema>;
export type CreateDealBody = z.infer<typeof createDealBodySchema>;
export type UpdateDealBody = z.infer<typeof updateDealBodySchema>;
export type TransitionDealBody = z.infer<typeof transitionDealBodySchema>;
export type DealHistoryQuery = z.infer<typeof dealHistoryQuerySchema>;
export type DealParams = z.infer<typeof dealUuidParamsSchema>;
