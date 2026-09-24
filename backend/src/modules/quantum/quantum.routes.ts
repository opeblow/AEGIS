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
  getOptimizationRun,
  listOptimizationRuns,
  runDealOptimization,
} from "./quantum.service.js";
import {
  dealIdParamsSchema,
  compareRequestBodySchema,
  listRunsQuerySchema,
  optimizeRequestBodySchema,
  runIdParamsSchema,
} from "./quantum.schemas.js";
import { OptimizationOperation } from "./quantum.schemas.js";

/**
 * Quantum Optimization (Phase 10) endpoints.
 *
 * Authorization is participant-first, then member-permission:
 *   resolveDealViewer(dealId, userId)   -> participant confidentiality (404
 *                                          for strangers, same as a bad id);
 *   authorize(request, viewer.org, Permissions.Optimization*) -> the
 *   viewer's ACTIVE membership must carry the permission for their role.
 *
 * `OptimizationRead` (list/get stored runs) is granted to OWNER/ADMIN/MEMBER;
 * `OptimizationRun` (optimize/compare — invokes the external quantum
 * provider) to OWNER/ADMIN only. Runs are scoped to the viewer's
 * organization, so one org's history never leaks to another participant.
 */
const quantumRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    run: { max: 10, timeWindow: "1 minute" },
    read: { max: 120, timeWindow: "1 minute" },
  } as const;

  app.post(
    "/deals/:dealId/optimization/optimize",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.run },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(optimizeRequestBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OptimizationRun);
      const outcome = await runDealOptimization(
        viewer,
        dealId,
        OptimizationOperation.Optimize,
        body,
        userId,
        requestMeta(request),
      );
      return {
        run: outcome.run,
        replayed: outcome.replayed,
        note: "Quantum optimization output is advisory only and never mutates authoritative state.",
      };
    },
  );

  app.post(
    "/deals/:dealId/optimization/compare",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.run },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(compareRequestBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.OptimizationRun);
      const outcome = await runDealOptimization(
        viewer,
        dealId,
        OptimizationOperation.Compare,
        body,
        userId,
        requestMeta(request),
      );
      return {
        run: outcome.run,
        replayed: outcome.replayed,
        note: "Quantum comparison output is advisory only and never mutates authoritative state.",
      };
    },
  );

  app.get(
    "/deals/:dealId/optimization",
    { preHandler: [app.authenticate], config: { rateLimit: limits.read } },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(listRunsQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(
        request,
        viewer.organizationId,
        Permissions.OptimizationRead,
      );
      return listOptimizationRuns(viewer, dealId, query);
    },
  );

  app.get(
    "/deals/:dealId/optimization/:runId",
    { preHandler: [app.authenticate], config: { rateLimit: limits.read } },
    async (request) => {
      const { dealId, runId } = validate(runIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(
        request,
        viewer.organizationId,
        Permissions.OptimizationRead,
      );
      return getOptimizationRun(viewer, dealId, runId);
    },
  );

  done();
};

export default quantumRoutes;