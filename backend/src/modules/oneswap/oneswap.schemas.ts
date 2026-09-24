import { z } from "zod";

const tokenSymbol = z.string().trim().min(1).max(32);
const poolId = z.string().trim().min(1).max(128);
const positiveAmount = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,10})?$/, "Amount must be a decimal with at most 10 places")
  .refine((value) => Number.isFinite(Number(value)) && Number(value) > 0, "Amount must be positive");
const slippageTolerance = z.number().positive().max(50).default(0.5);

export const dealIdParamsSchema = z.object({
  dealId: z.string().uuid(),
});

export const swapIdParamsSchema = z.object({
  dealId: z.string().uuid(),
  swapId: z.string().min(1).max(128),
});

export const poolIdParamsSchema = z.object({
  dealId: z.string().uuid(),
  poolId,
});

export const quoteRequestBodySchema = z.object({
  fromToken: tokenSymbol,
  toToken: tokenSymbol,
  fromAmount: positiveAmount,
  poolId: poolId.optional(),
}).strict();
export type QuoteRequestBody = z.infer<typeof quoteRequestBodySchema>;

export const swapExecuteBodySchema = z.object({
  idempotencyKey: z.string().min(16).max(128),
  fromToken: tokenSymbol,
  toToken: tokenSymbol,
  fromAmount: positiveAmount,
  poolId: poolId.optional(),
  minimumToAmount: positiveAmount.optional(),
  slippageTolerance,
  referenceNote: z.string().max(512).optional(),
}).strict();
export type SwapExecuteBody = z.infer<typeof swapExecuteBodySchema>;

/**
 * The Canton transfer that funded a swap's deposit, executed by the user in
 * their Metatarz wallet. `updateId` is the Canton ledger update id returned by
 * the wallet (tx.hash from the EIP-1193 flow).
 */
export const swapDepositBodySchema = z.object({
  updateId: z
    .string()
    .regex(/^0x[0-9a-fA-F]{4,128}$/, "updateId must be a 0x-prefixed Canton update id"),
  senderAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  referenceNote: z.string().max(512).optional(),
}).strict();
export type SwapDepositBody = z.infer<typeof swapDepositBodySchema>;

// The official OneSwap SDK currently exposes pool reads and swaps, but has no
// add/remove-LP-intent method. Keep these request schemas for a future adapter;
// route handlers return an explicit unsupported-operation error meanwhile.
export const liquidityAddBodySchema = z.object({
  poolId,
  token0Amount: positiveAmount,
  token1Amount: positiveAmount,
  referenceNote: z.string().max(512).optional(),
}).strict();
export type LiquidityAddBody = z.infer<typeof liquidityAddBodySchema>;

export const liquidityRemoveBodySchema = z.object({
  poolId,
  lpTokenAmount: positiveAmount,
  referenceNote: z.string().max(512).optional(),
}).strict();
export type LiquidityRemoveBody = z.infer<typeof liquidityRemoveBodySchema>;
