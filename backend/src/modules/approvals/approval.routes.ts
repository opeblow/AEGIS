import { z } from "zod";
import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { validate } from "../../lib/validation.js";
import { requestMeta } from "../organizations/route-helpers.js";
import { authorize, actorUserId } from "../organizations/authorization.service.js";
import { Permissions } from "../organizations/permissions.js";
import { AppError } from "../../lib/errors/index.js";
import {
  activateApprovalPolicy,
  archiveApprovalPolicy,
  cancelApprovalWorkflow,
  checkDealReadiness,
  createApprovalPolicy,
  deactivateApprovalPolicy,
  expireApprovalWorkflows,
  getApprovalPolicy,
  getApprovalPolicyForDeal,
  getApprovalsForDeal,
  getApprovalWorkflow,
  listApprovalPolicies,
  listApprovalWorkflows,
  startApprovalWorkflow,
  updateApprovalPolicy,
} from "./approval-policy.service.js";
import {
  decideApprovalRequest,
  assignApprovalRequest,
  cancelApprovalRequest,
  escalateApprovalRequest,
  getApprovalRequest,
  listApprovalRequests,
} from "./approval-request.service.js";
import {
  createPolicyBodySchema,
  decideRequestBodySchema,
  dealUuidParamsSchema,
  policyListQuerySchema,
  policyUuidParamsSchema,
  requestUuidParamsSchema,
  startWorkflowBodySchema,
  updatePolicyBodySchema,
  validateAllRules,
  workflowUuidParamsSchema,
  workflowListQuerySchema,
  requestListQuerySchema,
} from "./approval.schemas.js";

const approvalRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    createPolicy: { max: 10, timeWindow: "1 minute" },
    startWorkflow: { max: 30, timeWindow: "1 minute" },
    decide: { max: 60, timeWindow: "1 minute" },
  } as const;

  // =====================================================================
  // Approval Policy CRUD
  // =====================================================================

  /** POST /api/v1/organizations/:organizationId/approval-policies */
  app.post(
    "/organizations/:organizationId/approval-policies",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.createPolicy },
    },
    async (request, reply) => {
      const { organizationId } = validate(
        policyUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const body = validate(createPolicyBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.ApprovalsRead);

      for (const rule of body.rules) {
        validateAllRules([rule as { ruleType: string; config: unknown }]);
      }

      const { policy } = await createApprovalPolicy(
        organizationId,
        {
          name: body.name,
          description: body.description,
          rules: body.rules.map((r) => ({
            ruleType: r.ruleType as string,
            config: r.config as Record<string, unknown>,
          })),
        },
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ policy });
    },
  );

  /** GET /api/v1/organizations/:organizationId/approval-policies */
  app.get(
    "/organizations/:organizationId/approval-policies",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        policyUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const query = validate(policyListQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      return listApprovalPolicies(organizationId, query);
    },
  );

  /** GET /api/v1/organizations/:organizationId/approval-policies/:policyId */
  app.get(
    "/organizations/:organizationId/approval-policies/:policyId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, policyId } = validate(
        policyUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const policy = await getApprovalPolicy(organizationId, policyId);
      if (!policy) throw AppError.approvalPolicyNotFound();
      return { policy };
    },
  );

  /** PATCH /api/v1/organizations/:organizationId/approval-policies/:policyId */
  app.patch(
    "/organizations/:organizationId/approval-policies/:policyId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.createPolicy },
    },
    async (request, _reply) => {
      const { organizationId, policyId } = validate(
        policyUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(updatePolicyBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const { policy } = await updateApprovalPolicy(
        organizationId,
        policyId,
        {
          name: body.name,
          description: body.description,
          rules: body.rules
            ? body.rules.map((r) => ({
                ruleType: r.ruleType as string,
                config: r.config as Record<string, unknown>,
              }))
            : undefined,
        },
        actorUserId(request),
        requestMeta(request),
      );
      return { policy };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-policies/:policyId/activate */
  app.post(
    "/organizations/:organizationId/approval-policies/:policyId/activate",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, policyId } = validate(
        policyUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const { policy } = await activateApprovalPolicy(
        organizationId,
        policyId,
        actorUserId(request),
        requestMeta(request),
      );
      return { policy };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-policies/:policyId/deactivate */
  app.post(
    "/organizations/:organizationId/approval-policies/:policyId/deactivate",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, policyId } = validate(
        policyUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const { policy } = await deactivateApprovalPolicy(
        organizationId,
        policyId,
        actorUserId(request),
        requestMeta(request),
      );
      return { policy };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-policies/:policyId/archive */
  app.post(
    "/organizations/:organizationId/approval-policies/:policyId/archive",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, policyId } = validate(
        policyUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const { policy } = await archiveApprovalPolicy(
        organizationId,
        policyId,
        actorUserId(request),
        requestMeta(request),
      );
      return { policy };
    },
  );

  // =====================================================================
  // Approval Workflows
  // =====================================================================

  /** POST /api/v1/organizations/:organizationId/deals/:dealId/approval-workflows */
  app.post(
    "/organizations/:organizationId/deals/:dealId/approval-workflows",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.startWorkflow },
    },
    async (request, reply) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(startWorkflowBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.ApprovalsRead);

      const readiness = await checkDealReadiness(organizationId, dealId);
      if (!readiness.ready) {
        throw AppError.approvalRequirementsIncomplete(
          `Readiness gates not satisfied: ${readiness.gates.filter((g) => !g.ready).map((g) => g.gateType).join(", ")}`,
        );
      }

      const { workflow, assignments } = await startApprovalWorkflow(
        organizationId,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ workflow, assignments });
    },
  );

  /** GET /api/v1/organizations/:organizationId/deals/:dealId/approval-workflows */
  app.get(
    "/organizations/:organizationId/deals/:dealId/approval-workflows",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const approvals = await getApprovalsForDeal(organizationId, dealId);
      return { approvals };
    },
  );

  /** GET /api/v1/organizations/:organizationId/approval-workflows/:workflowId */
  app.get(
    "/organizations/:organizationId/approval-workflows/:workflowId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, workflowId } = validate(
        workflowUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const workflow = await getApprovalWorkflow(organizationId, workflowId);
      if (!workflow) throw AppError.approvalWorkflowNotFound();
      return { workflow };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-workflows/:workflowId/cancel */
  app.post(
    "/organizations/:organizationId/approval-workflows/:workflowId/cancel",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, workflowId } = validate(
        workflowUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const { workflow } = await cancelApprovalWorkflow(
        organizationId,
        workflowId,
        actorUserId(request),
        requestMeta(request),
      );
      return { workflow };
    },
  );

  /** GET /api/v1/organizations/:organizationId/approval-workflows */
  app.get(
    "/organizations/:organizationId/approval-workflows",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        policyUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const query = validate(workflowListQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      return listApprovalWorkflows(organizationId, query);
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-workflows/expire */
  app.post(
    "/organizations/:organizationId/approval-workflows/expire",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId } = validate(
        policyUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const expired = await expireApprovalWorkflows();
      return { expired };
    },
  );

  // =====================================================================
  // Approval Requests (Decisions)
  // =====================================================================

  /** GET /api/v1/organizations/:organizationId/approval-requests */
  app.get(
    "/organizations/:organizationId/approval-requests",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        policyUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const query = validate(requestListQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      return listApprovalRequests(organizationId, query);
    },
  );

  /** GET /api/v1/organizations/:organizationId/approval-requests/:requestId */
  app.get(
    "/organizations/:organizationId/approval-requests/:requestId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, requestId } = validate(
        requestUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const detail = await getApprovalRequest(organizationId, requestId);
      if (!detail) throw AppError.approvalRequestNotFound();
      return { request: detail };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-requests/:requestId/decide */
  app.post(
    "/organizations/:organizationId/approval-requests/:requestId/decide",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.decide },
    },
    async (request, reply) => {
      const { organizationId, requestId } = validate(
        requestUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(decideRequestBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.ApprovalsDecide);
      const result = await decideApprovalRequest(
        organizationId,
        requestId,
        actorUserId(request),
        body,
        requestMeta(request),
      );
      return reply.status(200).send(result);
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-requests/:requestId/assign */
  app.post(
    "/organizations/:organizationId/approval-requests/:requestId/assign",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, requestId } = validate(
        requestUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(
        z.object({ approverUserId: z.string().uuid() }),
        request.body,
        "body",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const result = await assignApprovalRequest(
        organizationId,
        requestId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { result };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-requests/:requestId/escalate */
  app.post(
    "/organizations/:organizationId/approval-requests/:requestId/escalate",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, requestId } = validate(
        requestUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(
        z.object({ reason: z.string().max(2000).optional() }),
        request.body,
        "body",
      );
      await authorize(request, organizationId, Permissions.ApprovalsDecide);
      const result = await escalateApprovalRequest(
        organizationId,
        requestId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { result };
    },
  );

  /** POST /api/v1/organizations/:organizationId/approval-requests/:requestId/cancel */
  app.post(
    "/organizations/:organizationId/approval-requests/:requestId/cancel",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request, _reply) => {
      const { organizationId, requestId } = validate(
        requestUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const result = await cancelApprovalRequest(
        organizationId,
        requestId,
        actorUserId(request),
        requestMeta(request),
      );
      return { result };
    },
  );

  // =====================================================================
  // Readiness & Compliance Gates
  // =====================================================================

  /** GET /api/v1/organizations/:organizationId/deals/:dealId/approval-readiness */
  app.get(
    "/organizations/:organizationId/deals/:dealId/approval-readiness",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const readiness = await checkDealReadiness(organizationId, dealId);
      return readiness;
    },
  );

  /** GET /api/v1/organizations/:organizationId/deals/:dealId/approval-policy */
  app.get(
    "/organizations/:organizationId/deals/:dealId/approval-policy",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.ApprovalsRead);
      const policy = await getApprovalPolicyForDeal(organizationId, dealId);
      if (!policy) {
        return { policy: null, message: "No active approval policy." };
      }
      return { policy };
    },
  );
  done();
};

export default approvalRoutes;
