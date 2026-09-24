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
  analyzeDealIntelligence,
  getDealIntelligenceRun,
  listDealIntelligenceRuns,
  queryDealIntelligence,
} from "./ai.service.js";
import {
  dealIdParamsSchema,
  intelligenceQueryBodySchema,
  listRunsQuerySchema,
  runIdParamsSchema,
} from "./ai.schemas.js";

/**
 * Deal Intelligence (Phase 9) endpoints.
 *
 * Authorization is participant-first, then member-permission:
 *   resolveDealViewer(dealId, userId)   -> participant confidentiality (404
 *                                          for strangers, same as a bad id);
 *   authorize(request, viewer.org, Permissions.DealIntelligence*) -> the
 *   viewer's ACTIVE membership must carry the permission for their role.
 *
 * `DealIntelligenceRead` (list/get stored runs) is granted to OWNER/ADMIN/
 * MEMBER; `DealIntelligenceAnalyze` (analyze/Q&A — invokes the external
 * provider) to OWNER/ADMIN only. Runs are scoped to the viewer's
 * organization, so one org's history never leaks to another participant.
 */
const aiRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    analyze: { max: 10, timeWindow: "1 minute" },
    query: { max: 15, timeWindow: "1 minute" },
    read: { max: 120, timeWindow: "1 minute" },
  } as const;

  app.post(
    "/deals/:dealId/intelligence/analyze",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.analyze },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.DealIntelligenceAnalyze);
      const outcome = await analyzeDealIntelligence(
        viewer,
        dealId,
        userId,
        requestMeta(request),
      );
      return {
        run: outcome.run,
        replayed: outcome.replayed,
        note: "AI output is advisory only and never mutates authoritative state.",
      };
    },
  );

  app.get(
    "/deals/:dealId/intelligence",
    { preHandler: [app.authenticate], config: { rateLimit: limits.read } },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(listRunsQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.DealIntelligenceRead);
      return listDealIntelligenceRuns(viewer, dealId, query);
    },
  );

  app.get(
    "/deals/:dealId/intelligence/:runId",
    { preHandler: [app.authenticate], config: { rateLimit: limits.read } },
    async (request) => {
      const { dealId, runId } = validate(runIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.DealIntelligenceRead);
      return getDealIntelligenceRun(viewer, dealId, runId);
    },
  );

  app.post(
    "/deals/:dealId/intelligence/query",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.query },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(intelligenceQueryBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.DealIntelligenceAnalyze);
      const { answer } = await queryDealIntelligence(
        viewer,
        dealId,
        body.question,
        userId,
        requestMeta(request),
      );
      return {
        answer,
        note: "This is an AI-generated interpretation; it is advisory.",
      };
    },
  );

  done();
};

export default aiRoutes;