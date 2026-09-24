import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { validate } from "../../lib/validation.js";
import { requestMeta } from "../organizations/route-helpers.js";
import {
  authorize,
  actorUserId,
} from "../organizations/authorization.service.js";
import { Permissions } from "../organizations/permissions.js";
import {
  createDeal,
  getDeal,
  getDealHistory,
  listDeals,
  transitionDeal,
  updateDeal,
} from "./deal.service.js";
import {
  createDealBodySchema,
  dealHistoryQuerySchema,
  dealQuerySchema,
  dealUuidParamsSchema,
  transitionDealBodySchema,
  updateDealBodySchema,
} from "./deal.schemas.js";

/**
 * Deal endpoints (Phase 4). Every handler resolves organization access and a
 * required permission FIRST (via the Phase 3 authorization pipeline), then
 * passes only the organization id into organization-scoped service calls.
 *
 * Status cannot be written through PATCH — the only status-changing endpoint
 * is the transition route, which routes through the state machine.
 */
const dealRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    create: { max: 30, timeWindow: "1 minute" },
    update: { max: 60, timeWindow: "1 minute" },
    transition: { max: 60, timeWindow: "1 minute" },
  } as const;

  /** POST /api/v1/organizations/:organizationId/deals */
  app.post(
    "/organizations/:organizationId/deals",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.create },
    },
    async (request, reply) => {
      const { organizationId } = validate(
        dealUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const body = validate(createDealBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.DealsCreate);
      const deal = await createDeal(
        organizationId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ deal });
    },
  );

  /** GET /api/v1/organizations/:organizationId/deals */
  app.get(
    "/organizations/:organizationId/deals",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        dealUuidParamsSchema.pick({ organizationId: true }).strict(),
        request.params,
        "params",
      );
      const query = validate(dealQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.DealsRead);
      const page = await listDeals(organizationId, query);
      return page;
    },
  );

  /** GET /api/v1/organizations/:organizationId/deals/:dealId */
  app.get(
    "/organizations/:organizationId/deals/:dealId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.DealsRead);
      const deal = await getDeal(organizationId, dealId);
      return { deal };
    },
  );

  /** GET /api/v1/organizations/:organizationId/deals/:dealId/history */
  app.get(
    "/organizations/:organizationId/deals/:dealId/history",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      const query = validate(dealHistoryQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.DealsRead);
      const history = await getDealHistory(organizationId, dealId, query);
      return history;
    },
  );

  /** PATCH /api/v1/organizations/:organizationId/deals/:dealId */
  app.patch(
    "/organizations/:organizationId/deals/:dealId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.update },
    },
    async (request) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(updateDealBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.DealsUpdate);
      const deal = await updateDeal(
        organizationId,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { deal };
    },
  );

  /**
   * POST /api/v1/organizations/:organizationId/deals/:dealId/transitions
   *
   * The only way to change a deal's status. Cancellation is a transition to
   * `CANCELLED` on this same endpoint.
   */
  app.post(
    "/organizations/:organizationId/deals/:dealId/transitions",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.transition },
    },
    async (request, reply) => {
      const { organizationId, dealId } = validate(
        dealUuidParamsSchema,
        request.params,
        "params",
      );
      const body = validate(transitionDealBodySchema, request.body, "body");
      await authorize(request, organizationId, Permissions.DealsTransition);
      const result = await transitionDeal(
        organizationId,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply
        .status(200)
        .send({ deal: result.deal, transition: result.transition });
    },
  );

  done();
};

export default dealRoutes;
