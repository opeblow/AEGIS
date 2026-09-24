import { z } from "zod";

export const initiateSettlementBodySchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  requestId: z.string().min(1).max(256).optional(),
});

export type InitiateSettlementBody = z.infer<typeof initiateSettlementBodySchema>;

export const reconcileSettlementBodySchema = z.object({
  requestId: z.string().min(1).max(256),
});

export type ReconcileSettlementBody = z.infer<typeof reconcileSettlementBodySchema>;

export const resolveReconciliationBodySchema = z.object({
  requestId: z.string().min(1).max(256),
  resolutionReason: z.string().min(1).max(2000),
});

export type ResolveReconciliationBody = z.infer<typeof resolveReconciliationBodySchema>;

export function validateInitiateSettlementBody(
  body: unknown,
): InitiateSettlementBody {
  const result = initiateSettlementBodySchema.safeParse(body);
  if (!result.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid settlement initiation body.",
      details: result.error.issues,
    });
  }
  return result.data;
}

export function validateReconcileSettlementBody(
  body: unknown,
): ReconcileSettlementBody {
  const result = reconcileSettlementBodySchema.safeParse(body);
  if (!result.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid reconciliation body.",
      details: result.error.issues,
    });
  }
  return result.data;
}

export function validateResolveReconciliationBody(
  body: unknown,
): ResolveReconciliationBody {
  const result = resolveReconciliationBodySchema.safeParse(body);
  if (!result.success) {
    throw new AppError({
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: "Invalid reconciliation resolution body.",
      details: result.error.issues,
    });
  }
  return result.data;
}

export function assertSettlementAmountMatchesDeal(
  settlementAmount: string,
  settlementCurrency: string,
  dealNotionalAmount: string,
  dealCurrency: string,
): void {
  if (settlementCurrency !== dealCurrency) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_CURRENCY",
      message: `Settlement currency ${settlementCurrency} does not match deal currency ${dealCurrency}.`,
    });
  }
  if (settlementAmount !== dealNotionalAmount) {
    throw new AppError({
      statusCode: 400,
      code: "INVALID_MONEY_AMOUNT",
      message: `Settlement amount ${settlementAmount} does not match deal notional amount ${dealNotionalAmount}.`,
    });
  }
}

import { AppError } from "../../lib/errors/index.js";