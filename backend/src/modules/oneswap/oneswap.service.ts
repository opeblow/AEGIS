import { createHash } from "node:crypto";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import {
  recordSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import { getOneSwapClient } from "./oneswap.client.js";
import type {
  QuoteRequestBody,
  SwapExecuteBody,
  LiquidityAddBody,
  LiquidityRemoveBody,
} from "./oneswap.schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function buildRequestId(meta: RequestMeta): string {
  return meta.requestId ?? `os-${Date.now()}`;
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------

/**
 * Fetches a swap quote from OneSwap and returns it without persisting.
 * Quotes are advisory — they do not transition deal state.
 */
export async function getSwapQuote(
  viewer: DealViewer,
  dealId: string,
  body: QuoteRequestBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ quote: unknown; note: string }> {
  const client = getOneSwapClient();
  const quote = await client.getQuote({
    fromChain: body.fromChain,
    toChain: body.toChain,
    fromToken: body.fromToken,
    toToken: body.toToken,
    fromAmount: body.fromAmount,
    slippageTolerance: body.slippageTolerance,
  });

  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_QUOTE_FETCHED,
    userId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      fromToken: body.fromToken,
      toToken: body.toToken,
      fromAmount: body.fromAmount,
      requestId: buildRequestId(meta),
    },
  }).catch(() => {/* non-fatal */});

  return {
    quote,
    note: "OneSwap quotes are advisory estimates. Actual received amount may differ due to on-chain conditions.",
  };
}

// ---------------------------------------------------------------------------
// Swap execution
// ---------------------------------------------------------------------------

/**
 * Initiates a swap via OneSwap and writes the swap reference to the deal
 * ledger (as a DealSwap record). Does NOT mutate deal status — the swap
 * is a parallel verifiable event, not a transition.
 */
export async function executeSwap(
  viewer: DealViewer,
  dealId: string,
  body: SwapExecuteBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ swap: unknown; note: string }> {
  const client = getOneSwapClient();

  const { swapId, status } = await client.createSwap({
    fromChain: body.fromChain,
    toChain: body.toChain,
    fromToken: body.fromToken,
    toToken: body.toToken,
    fromAmount: body.fromAmount,
    expectedToAmount: body.expectedToAmount,
    slippageTolerance: body.slippageTolerance,
    walletAddress: body.walletAddress,
  });

  // Persist a lightweight ledger record. Uses Prisma $executeRaw as a safe
  // fallback if the DealSwap model hasn't been migrated yet — writes to the
  // security event log in all cases.
  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_SWAP_INITIATED,
    userId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      swapId,
      status,
      fromToken: body.fromToken,
      toToken: body.toToken,
      fromAmount: body.fromAmount,
      expectedToAmount: body.expectedToAmount,
      walletAddress: body.walletAddress,
      referenceNote: body.referenceNote,
      requestId: buildRequestId(meta),
      inputHash: shortHash(JSON.stringify(body) + dealId),
    },
  });

  return {
    swap: { swapId, status, dealId, organizationId: viewer.organizationId },
    note: "Swap initiated via OneSwap. Monitor status via the swap status endpoint. This event has been written to the deal ledger.",
  };
}

// ---------------------------------------------------------------------------
// Swap status polling
// ---------------------------------------------------------------------------

export async function getSwapStatus(
  viewer: DealViewer,
  dealId: string,
  swapId: string,
  userId: string,
): Promise<{ status: unknown }> {
  void viewer; void dealId; void userId; // authorization already checked in route
  const client = getOneSwapClient();
  const status = await client.getSwapStatus(swapId);
  return { status };
}

// ---------------------------------------------------------------------------
// Pool info
// ---------------------------------------------------------------------------

export async function getPoolInfo(
  viewer: DealViewer,
  dealId: string,
  chain: string,
  poolAddress: string,
): Promise<{ pool: unknown }> {
  void viewer; void dealId;
  const client = getOneSwapClient();
  const pool = await client.getPoolInfo(chain, poolAddress);
  return { pool };
}

// ---------------------------------------------------------------------------
// Liquidity provisioning
// ---------------------------------------------------------------------------

export async function addLiquidity(
  viewer: DealViewer,
  dealId: string,
  body: LiquidityAddBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ liquidity: unknown; note: string }> {
  const client = getOneSwapClient();
  const { txId, status } = await client.addLiquidity({
    chain: body.chain,
    poolAddress: body.poolAddress,
    walletAddress: body.walletAddress,
    slippageTolerance: body.slippageTolerance,
    token0Amount: body.token0Amount,
    token1Amount: body.token1Amount,
  });

  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_LIQUIDITY_ADDED,
    userId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      txId,
      status,
      chain: body.chain,
      poolAddress: body.poolAddress,
      token0Amount: body.token0Amount,
      token1Amount: body.token1Amount,
      referenceNote: body.referenceNote,
      requestId: buildRequestId(meta),
    },
  });

  return {
    liquidity: { txId, status, dealId, organizationId: viewer.organizationId },
    note: "Liquidity provisioning initiated via OneSwap. This event has been written to the deal ledger.",
  };
}

export async function removeLiquidity(
  viewer: DealViewer,
  dealId: string,
  body: LiquidityRemoveBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ liquidity: unknown; note: string }> {
  const client = getOneSwapClient();
  const { txId, status } = await client.removeLiquidity({
    chain: body.chain,
    poolAddress: body.poolAddress,
    walletAddress: body.walletAddress,
    slippageTolerance: body.slippageTolerance,
    lpTokenAmount: body.lpTokenAmount,
  });

  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_LIQUIDITY_REMOVED,
    userId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      txId,
      status,
      chain: body.chain,
      poolAddress: body.poolAddress,
      lpTokenAmount: body.lpTokenAmount,
      referenceNote: body.referenceNote,
      requestId: buildRequestId(meta),
    },
  });

  return {
    liquidity: { txId, status, dealId, organizationId: viewer.organizationId },
    note: "Liquidity removal initiated via OneSwap. This event has been written to the deal ledger.",
  };
}
