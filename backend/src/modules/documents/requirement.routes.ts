import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { validate } from "../../lib/validation.js";
import { requestMeta } from "../organizations/route-helpers.js";
import { actorUserId } from "../organizations/authorization.service.js";
import { resolveDealViewer } from "../negotiation/participant-policy.js";
import {
  createRequirement,
  submitRequirement,
  rejectRequirement,
  waiveRequirement,
  reopenRequirement,
  satisfyRequirement,
  attachRequirementDocument,
  getRequirement,
  listRequirements,
  getRequirementReadiness,
} from "./requirement.service.js";
import {
  createRequirementBodySchema,
  submitRequirementBodySchema,
  rejectRequirementBodySchema,
  waiveRequirementBodySchema,
  reopenRequirementBodySchema,
  satisfyRequirementBodySchema,
  attachRequirementDocumentBodySchema,
  requirementQuerySchema,
  dealIdParamsSchema,
  requirementIdParamsSchema,
} from "./requirement.schemas.js";

/**
 * Phase 6 deal requirement endpoints (deal-participant scoped).
 *
 * Requirements are owner-defined; the assigned organization (and the owner)
 * submit evidence; verdicts (reject/waive/satisfy) are owner-only. Readiness
 * is an owner-only snapshot that reflects the CURRENT materialized state.
 */
const requirementRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    requirementCreate: { max: 30, timeWindow: "1 minute" },
    requirementAction: { max: 60, timeWindow: "1 minute" },
    requirementReadiness: { max: 60, timeWindow: "1 minute" },
  } as const;

  app.get(
    "/deals/:dealId/requirements",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(requirementQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      return listRequirements(viewer, dealId, query);
    },
  );

  app.post(
    "/deals/:dealId/requirements",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementCreate },
    },
    async (request, reply) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(createRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const requirement = await createRequirement(
        viewer,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ requirement });
    },
  );

  app.get(
    "/deals/:dealId/requirements/:requirementId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const requirement = await getRequirement(viewer, dealId, requirementId);
      return { requirement };
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/submit",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(submitRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await submitRequirement(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/reject",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(rejectRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await rejectRequirement(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/waive",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(waiveRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await waiveRequirement(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/reopen",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(reopenRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await reopenRequirement(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/satisfy",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(satisfyRequirementBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await satisfyRequirement(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/requirements/:requirementId/attach",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.requirementAction },
    },
    async (request) => {
      const { dealId, requirementId } = validate(
        requirementIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(
        attachRequirementDocumentBodySchema,
        request.body,
        "body",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const requirement = await attachRequirementDocument(
        viewer,
        dealId,
        requirementId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { requirement };
    },
  );

  app.get(
    "/deals/:dealId/readiness",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: limits.requirementReadiness },
    },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const readiness = await getRequirementReadiness(viewer, dealId);
      return { readiness };
    },
  );

  done();
};

export default requirementRoutes;
