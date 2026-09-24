import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import { recordSecurityEvent, SecurityEventType } from "../auth/security-events.js";
import { getOneSwapClient } from "./oneswap.client.js";
import type { LiquidityAddBody, LiquidityRemoveBody, QuoteRequestBody, SwapExecuteBody } from "./oneswap.schemas.js";

function buildRequestId(meta: RequestMeta): string {
  return meta.requestId ?? `oneswap-${Date.now()}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function asSdkAmount(amount: string): number {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw AppError.validation("OneSwap amount must be a positive supported number.");
  }
  return parsed;
}

function stableUserRef(viewer: DealViewer, userId: string): string {
  return sha256(`${viewer.organizationId}:${userId}`);
}

function idempotencyConflict(message = "This idempotency key was already used for a different OneSwap request."): AppError {
  return new AppError({ statusCode: 409, code: "ONESWAP_IDEMPOTENCY_CONFLICT", message });
}

function sameIntent(
  swap: { inSymbol: string; outSymbol: string; amountIn: number; poolId: string; minOut: number | null },
  body: SwapExecuteBody,
): boolean {
  return swap.inSymbol === body.fromToken
    && swap.outSymbol === body.toToken
    && Number(swap.amountIn) === asSdkAmount(body.fromAmount)
    && (!body.poolId || swap.poolId === body.poolId)
    && (!body.minimumToAmount || Number(swap.minOut) === asSdkAmount(body.minimumToAmount));
}

interface OneSwapOperationRow {
  id: string;
  idempotencyPayloadHash: string;
  providerReference: string | null;
  status: string;
  dealId: string;
  requestedByUserId: string;
}

async function findOperationByIdempotencyKey(
  organizationId: string,
  idempotencyKeyHash: string,
): Promise<OneSwapOperationRow | null> {
  const rows = await prisma.$queryRaw<OneSwapOperationRow[]>`
    SELECT "id", "idempotencyPayloadHash", "providerReference", "status", "dealId", "requestedByUserId"
    FROM "OneSwapOperation"
    WHERE "organizationId" = ${organizationId}::uuid
      AND "idempotencyKeyHash" = ${idempotencyKeyHash}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getSwapQuote(
  viewer: DealViewer,
  dealId: string,
  body: QuoteRequestBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ quote: unknown; note: string }> {
  const quote = await getOneSwapClient().getQuote({
    from: body.fromToken,
    to: body.toToken,
    amount: asSdkAmount(body.fromAmount),
    ...(body.poolId ? { poolId: body.poolId } : {}),
  });
  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_QUOTE_FETCHED,
    userId,
    organizationId: viewer.organizationId,
    metadata: { dealId, fromToken: body.fromToken, toToken: body.toToken, fromAmount: body.fromAmount, poolId: quote.poolId, requestId: buildRequestId(meta) },
  }).catch(() => undefined);
  return { quote, note: "Live OneSwap quote. It is not a guaranteed execution price; review pool, fees, and minimum output before creating a swap." };
}

export async function executeSwap(
  viewer: DealViewer,
  dealId: string,
  body: SwapExecuteBody,
  userId: string,
  meta: RequestMeta,
): Promise<{ swap: unknown; note: string; replay: boolean }> {
  const client = getOneSwapClient();
  const userRef = stableUserRef(viewer, userId);
  const requestPayload = {
    fromToken: body.fromToken,
    toToken: body.toToken,
    fromAmount: body.fromAmount,
    poolId: body.poolId ?? null,
    minimumToAmount: body.minimumToAmount ?? null,
    slippageTolerance: body.slippageTolerance,
  };
  const idempotencyKeyHash = sha256(body.idempotencyKey);
  const idempotencyPayloadHash = sha256(JSON.stringify(requestPayload));

  let operation = await findOperationByIdempotencyKey(viewer.organizationId, idempotencyKeyHash);
  if (operation && (operation.idempotencyPayloadHash !== idempotencyPayloadHash
    || operation.dealId !== dealId
    || operation.requestedByUserId !== userId)) throw idempotencyConflict();

  let createdNow = false;
  if (!operation) {
    const inserted = await prisma.$queryRaw<OneSwapOperationRow[]>`
      INSERT INTO "OneSwapOperation"
        ("id", "organizationId", "dealId", "requestedByUserId", "operationType", "status",
         "idempotencyKeyHash", "idempotencyPayloadHash", "request", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid(), ${viewer.organizationId}::uuid, ${dealId}::uuid, ${userId}::uuid,
         'SWAP', 'CREATING', ${idempotencyKeyHash}, ${idempotencyPayloadHash},
         ${JSON.stringify(requestPayload)}::jsonb, NOW(), NOW())
      ON CONFLICT ("organizationId", "idempotencyKeyHash") DO NOTHING
      RETURNING "id", "idempotencyPayloadHash", "providerReference", "status", "dealId", "requestedByUserId"
    `;
    operation = inserted[0] ?? await findOperationByIdempotencyKey(viewer.organizationId, idempotencyKeyHash);
    createdNow = inserted.length > 0;
    if (!operation) throw new Error("OneSwap operation could not be persisted.");
    if (operation.idempotencyPayloadHash !== idempotencyPayloadHash
      || operation.dealId !== dealId
      || operation.requestedByUserId !== userId) throw idempotencyConflict();
  }

  let swap;
  if (operation.providerReference) {
    swap = await client.getSwapStatus(operation.providerReference);
  } else {
    if (operation.status === "BLOCKED_OPEN_SWAP") {
      throw idempotencyConflict("This request is blocked by a different open OneSwap intent.");
    }
    const existingOpen = await client.getOpenSwap(userRef);
    if (existingOpen) {
      const trackedElsewhere = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "OneSwapOperation"
        WHERE "requestedByUserId" = ${userId}::uuid AND "providerReference" = ${existingOpen.id}
          AND "id" <> ${operation.id}::uuid
        LIMIT 1
      `;
      if (createdNow || trackedElsewhere.length > 0 || !sameIntent(existingOpen, body)) {
        if (createdNow) {
          await prisma.$executeRaw`
            UPDATE "OneSwapOperation" SET "status" = 'BLOCKED_OPEN_SWAP', "updatedAt" = NOW()
            WHERE "id" = ${operation.id}::uuid
          `;
        }
        throw idempotencyConflict("This Canton user already has a different open OneSwap intent.");
      }
      swap = existingOpen;
    } else {
      try {
        swap = await client.createSwap({
          userRef,
          inSymbol: body.fromToken,
          amountIn: asSdkAmount(body.fromAmount),
          outSymbol: body.toToken,
          ...(body.poolId ? { poolId: body.poolId } : {}),
          ...(body.minimumToAmount
            ? { minOut: asSdkAmount(body.minimumToAmount) }
            : { slippageBps: Math.round(body.slippageTolerance * 100) }),
        });
      } catch (cause) {
        // The provider may accept the request while its response is lost.
        const recovered = await client.getOpenSwap(userRef).catch(() => null);
        if (!recovered || !sameIntent(recovered, body)) throw cause;
        swap = recovered;
      }
    }
  }

  await prisma.$executeRaw`
    UPDATE "OneSwapOperation"
    SET "providerReference" = ${swap.id}, "providerStatus" = ${swap.status},
        "status" = ${swap.status}, "providerResponse" = ${JSON.stringify(swap)}::jsonb,
        "lastErrorCode" = NULL, "updatedAt" = NOW()
    WHERE "id" = ${operation.id}::uuid
  `;
  await recordSecurityEvent({
    type: SecurityEventType.ONESWAP_SWAP_INITIATED,
    userId,
    organizationId: viewer.organizationId,
    metadata: {
      dealId,
      operationId: operation.id,
      swapId: swap.id,
      status: swap.status,
      fromToken: swap.inSymbol,
      toToken: swap.outSymbol,
      fromAmount: String(swap.amountIn),
      poolId: swap.poolId,
      depositParty: swap.depositParty,
      deadline: swap.deadline,
      referenceNote: body.referenceNote,
      requestId: buildRequestId(meta),
      inputHash: idempotencyPayloadHash,
    },
  });
  return {
    swap,
    note: "OneSwap created a Canton swap intent. The user must review and send the specified token amount to depositParty from a Canton wallet before the deadline. A created intent is not a completed settlement.",
    replay: !createdNow,
  };
}

export async function getSwapStatus(
  viewer: DealViewer,
  dealId: string,
  swapId: string,
): Promise<{ status: unknown }> {
  const operations = await prisma.$queryRaw<OneSwapOperationRow[]>`
    SELECT "id", "idempotencyPayloadHash", "providerReference", "status", "dealId", "requestedByUserId"
    FROM "OneSwapOperation"
    WHERE "providerReference" = ${swapId}
      AND "organizationId" = ${viewer.organizationId}::uuid
      AND "dealId" = ${dealId}::uuid
    LIMIT 1
  `;
  const operation = operations[0];
  if (!operation) {
    throw new AppError({ statusCode: 404, code: "ONESWAP_OPERATION_NOT_FOUND", message: "OneSwap operation not found for this deal." });
  }
  const status = await getOneSwapClient().getSwapStatus(swapId);
  await prisma.$executeRaw`
    UPDATE "OneSwapOperation"
    SET "providerStatus" = ${status.status}, "status" = ${status.status},
        "providerResponse" = ${JSON.stringify(status)}::jsonb, "updatedAt" = NOW()
    WHERE "id" = ${operation.id}::uuid
  `;
  return { status };
}

export async function getPoolInfo(_viewer: DealViewer, _dealId: string, poolId: string): Promise<{ pool: unknown }> {
  return { pool: await getOneSwapClient().getPoolInfo(poolId) };
}

export async function listPools(): Promise<{ pools: unknown[] }> {
  return { pools: await getOneSwapClient().getPools() };
}

export async function listTokens(): Promise<{ tokens: unknown[] }> {
  return { tokens: await getOneSwapClient().getTokens() };
}

function liquidityNotSupported(): never {
  throw new AppError({ statusCode: 501, code: "ONESWAP_OPERATION_UNSUPPORTED", message: "The published OneSwap SDK does not expose liquidity add/remove operations yet." });
}

export async function addLiquidity(_viewer: DealViewer, _dealId: string, _body: LiquidityAddBody, _userId: string, _meta: RequestMeta): Promise<never> {
  return liquidityNotSupported();
}

export async function removeLiquidity(_viewer: DealViewer, _dealId: string, _body: LiquidityRemoveBody, _userId: string, _meta: RequestMeta): Promise<never> {
  return liquidityNotSupported();
}
