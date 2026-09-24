import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { validate } from "../../lib/validation.js";
import {
  actorUserId,
  authorize,
} from "../organizations/authorization.service.js";
import { Permissions } from "../organizations/permissions.js";
import { requestMeta } from "../organizations/route-helpers.js";
import { resolveDealViewer } from "../negotiation/participant-policy.js";
import {
  getSwapQuote,
  executeSwap,
  getSwapStatus,
  getPoolInfo,
  addLiquidity,
  removeLiquidity,
} from "./oneswap.service.js";
import {
  dealIdParamsSchema,
  swapIdParamsSchema,
  poolIdParamsSchema,
  quoteRequestBodySchema,
  swapExecuteBodySchema,
  liquidityAddBodySchema,
  liquidityRemoveBodySchema,
} from "./oneswap.schemas.js";

/**
 * OneSwap Integration (Phase 11) — REST routes.
 *
 * Authorization model mirrors AI/Quantum (Phase 9/10):
 *   resolveDealViewer(dealId, userId)  → participant confidentiality
 *   authorize(request, orgId, Perm)    → role-permission check
 *
 * OneSwap READ operations (quote, status, pool info) require DealRead.
 * OneSwap WRITE operations (swap, liquidity) require DealIntelligenceAnalyze
 * (OWNER/ADMIN only) — reusing the existing permission so no schema migration
 * is needed.
 *
 * All outputs are advisory ledger events; none mutate authoritative deal state.
 */
const oneswapRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    write: { max: 10, timeWindow: "1 minute" },
    read:  { max: 60, timeWindow: "1 minute" },
  } as const;

  // ── GET quote ──────────────────────────────────────────────────────────────
  app.post(
    "/deals/:dealId/oneswap/quote",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.write },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(quoteRequestBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OneSwapRead);
      return getSwapQuote(viewer, dealId, body, userId, requestMeta(request));
    },
  );

  // ── Execute swap ───────────────────────────────────────────────────────────
  app.post(
    "/deals/:dealId/oneswap/swap",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.write },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(swapExecuteBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OneSwapExecute);
      return executeSwap(viewer, dealId, body, userId, requestMeta(request));
    },
  );

  // ── Swap status ────────────────────────────────────────────────────────────
  app.get(
    "/deals/:dealId/oneswap/swap/:swapId",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: limits.read },
    },
    async (request) => {
      const { dealId, swapId } = validate(swapIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.OneSwapRead);
      return getSwapStatus(viewer, dealId, swapId, actorUserId(request));
    },
  );

  // ── Pool info ──────────────────────────────────────────────────────────────
  app.get(
    "/deals/:dealId/oneswap/pool/:poolId",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: limits.read },
    },
    async (request) => {
      const { dealId, poolId } = validate(poolIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.OneSwapRead);
      // poolId expected as "chain:address" — e.g. "ethereum:0x8ad599..."
      const [chain = "ethereum", ...rest] = poolId.split(":");
      const address = rest.join(":") || poolId;
      return getPoolInfo(viewer, dealId, chain, address);
    },
  );

  // ── Add liquidity ──────────────────────────────────────────────────────────
  app.post(
    "/deals/:dealId/oneswap/liquidity/add",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.write },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(liquidityAddBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OneSwapExecute);
      return addLiquidity(viewer, dealId, body, userId, requestMeta(request));
    },
  );

  // ── Remove liquidity ───────────────────────────────────────────────────────
  app.post(
    "/deals/:dealId/oneswap/liquidity/remove",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.write },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(liquidityRemoveBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OneSwapExecute);
      return removeLiquidity(viewer, dealId, body, userId, requestMeta(request));
    },
  );

  done();
};

export default oneswapRoutes;
