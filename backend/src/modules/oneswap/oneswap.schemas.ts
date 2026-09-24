import { z } from "zod";

/**
 * OneSwap Integration (Phase 11) — schemas.
 *
 * Covers:
 *  - Swap quote requests (token pair + amount → quote)
 *  - Swap execution (quote + slippage tolerance → swap)
 *  - Liquidity pool queries (pool address → pool info, depth)
 *  - LP position management (add/remove liquidity)
 *  - Swap status polling
 */

// ---------------------------------------------------------------------------
// Shared literals
// ---------------------------------------------------------------------------

export const SUPPORTED_CHAINS = [
  "ethereum",
  "arbitrum",
  "base",
  "optimism",
  "polygon",
  "bsc",
] as const;
export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export const SWAP_STATUSES = [
  "PENDING",
  "COMPLETED",
  "FAILED",
  "EXPIRED",
] as const;

export const LP_STATUSES = [
  "PENDING",
  "ACTIVE",
  "REMOVED",
  "FAILED",
] as const;

// ---------------------------------------------------------------------------
// Route params schemas
// ---------------------------------------------------------------------------

export const dealIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
});

export const swapIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
  swapId: z.string().min(1),
});

export const poolIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
  poolId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Quote request body
// ---------------------------------------------------------------------------

export const quoteRequestBodySchema = z
  .object({
    fromChain: z.enum(SUPPORTED_CHAINS),
    toChain: z.enum(SUPPORTED_CHAINS),
    fromToken: z
      .string()
      .min(1, "fromToken is required")
      .describe("Token symbol or contract address, e.g. ETH or 0x..."),
    toToken: z
      .string()
      .min(1, "toToken is required")
      .describe("Token symbol or contract address"),
    fromAmount: z
      .string()
      .min(1, "fromAmount is required")
      .describe("Amount of fromToken as a decimal string, e.g. '1.5'"),
    slippageTolerance: z
      .number()
      .min(0.001)
      .max(50)
      .default(0.5)
      .describe("Max slippage %, default 0.5"),
  })
  .strict();

export type QuoteRequestBody = z.infer<typeof quoteRequestBodySchema>;

// ---------------------------------------------------------------------------
// Swap execution body
// ---------------------------------------------------------------------------

export const swapExecuteBodySchema = z
  .object({
    fromChain: z.enum(SUPPORTED_CHAINS),
    toChain: z.enum(SUPPORTED_CHAINS),
    fromToken: z.string().min(1),
    toToken: z.string().min(1),
    fromAmount: z.string().min(1),
    expectedToAmount: z.string().min(1),
    slippageTolerance: z.number().min(0.001).max(50).default(0.5),
    walletAddress: z
      .string()
      .min(1, "walletAddress is required")
      .describe("Wallet address initiating the swap"),
    referenceNote: z
      .string()
      .max(512)
      .optional()
      .describe("Optional note written to deal ledger"),
  })
  .strict();

export type SwapExecuteBody = z.infer<typeof swapExecuteBodySchema>;

// ---------------------------------------------------------------------------
// Liquidity provisioning body
// ---------------------------------------------------------------------------

export const liquidityAddBodySchema = z
  .object({
    chain: z.enum(SUPPORTED_CHAINS),
    poolAddress: z.string().min(1, "poolAddress is required"),
    token0Amount: z.string().min(1),
    token1Amount: z.string().min(1),
    walletAddress: z.string().min(1),
    slippageTolerance: z.number().min(0.001).max(50).default(0.5),
    referenceNote: z.string().max(512).optional(),
  })
  .strict();

export type LiquidityAddBody = z.infer<typeof liquidityAddBodySchema>;

export const liquidityRemoveBodySchema = z
  .object({
    chain: z.enum(SUPPORTED_CHAINS),
    poolAddress: z.string().min(1),
    lpTokenAmount: z.string().min(1).describe("LP tokens to burn"),
    walletAddress: z.string().min(1),
    slippageTolerance: z.number().min(0.001).max(50).default(0.5),
    referenceNote: z.string().max(512).optional(),
  })
  .strict();

export type LiquidityRemoveBody = z.infer<typeof liquidityRemoveBodySchema>;

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

export const listSwapsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(SWAP_STATUSES).optional(),
});

export const listPoolsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  chain: z.enum(SUPPORTED_CHAINS).optional(),
});

// ---------------------------------------------------------------------------
// OneSwap service response schemas (mirroring external API responses)
// ---------------------------------------------------------------------------

export const quoteResponseSchema = z.object({
  quoteId: z.string(),
  fromChain: z.string(),
  toChain: z.string(),
  fromToken: z.string(),
  toToken: z.string(),
  fromAmount: z.string(),
  toAmount: z.string(),
  estimatedGas: z.string().optional(),
  priceImpact: z.number().optional(),
  route: z
    .array(
      z.object({
        protocol: z.string(),
        portion: z.number(),
      }),
    )
    .optional(),
  expiresAt: z.string().optional(),
});

export type OneSwapQuoteResponse = z.infer<typeof quoteResponseSchema>;

export const swapStatusResponseSchema = z.object({
  swapId: z.string(),
  status: z.enum(SWAP_STATUSES),
  txHash: z.string().optional(),
  fromAmount: z.string().optional(),
  toAmount: z.string().optional(),
  completedAt: z.string().optional(),
  failureReason: z.string().optional(),
});

export type OneSwapStatusResponse = z.infer<typeof swapStatusResponseSchema>;

export const poolInfoResponseSchema = z.object({
  poolAddress: z.string(),
  chain: z.string(),
  token0: z.object({ symbol: z.string(), address: z.string() }),
  token1: z.object({ symbol: z.string(), address: z.string() }),
  liquidity: z.string(),
  volumeUsd24h: z.string().optional(),
  feeTier: z.number().optional(),
  apr: z.number().optional(),
});

export type OneSwapPoolInfo = z.infer<typeof poolInfoResponseSchema>;
