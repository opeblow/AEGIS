import type { FastifyInstance, FastifyRequest } from "fastify";
import { authorize, actorUserId } from "../../organizations/authorization.service.js";
import { Permissions } from "../../organizations/permissions.js";
import type { RequestMeta } from "../../organizations/organization.service.js";
import { resolveDealViewer } from "../../negotiation/participant-policy.js";
import {
  performReconciliation,
  resolveReconciliation,
  getReconciliation,
  getReconciliationBySettlement,
  listReconciliations,
} from "./reconciliation.service.js";
import { validateReconcileSettlementBody, validateResolveReconciliationBody } from "../settlement.schemas.js";

function extractRequestMeta(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

export async function reconciliationRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/deals/:dealId/settlement/:settlementId/reconcile",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      schema: {
        params: {
          type: "object",
          properties: {
            dealId: { type: "string", format: "uuid" },
            settlementId: { type: "string", format: "uuid" },
          },
          required: ["dealId", "settlementId"],
        },
        body: {
          type: "object",
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["requestId"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              reconciliation: { type: "object", additionalProperties: true },
              matched: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId, settlementId } = request.params as {
        dealId: string;
        settlementId: string;
      };
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.SettlementExecute);
      const meta = extractRequestMeta(request);

      validateReconcileSettlementBody(request.body);

      const result = await performReconciliation(viewer.organizationId, settlementId, userId, meta);

      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/deals/:dealId/reconciliation/:reconciliationId/resolve",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      schema: {
        params: {
          type: "object",
          properties: {
            dealId: { type: "string", format: "uuid" },
            reconciliationId: { type: "string", format: "uuid" },
          },
          required: ["dealId", "reconciliationId"],
        },
        body: {
          type: "object",
          properties: {
            requestId: { type: "string", minLength: 1, maxLength: 256 },
            resolutionReason: { type: "string", minLength: 1, maxLength: 2000 },
          },
          required: ["requestId", "resolutionReason"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              reconciliation: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId, reconciliationId } = request.params as {
        dealId: string;
        reconciliationId: string;
      };
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.SettlementExecute);
      const meta = extractRequestMeta(request);

      const validated = validateResolveReconciliationBody(request.body);

      const result = await resolveReconciliation(viewer.organizationId, reconciliationId, validated, userId, meta);

      return reply.send({ reconciliation: result });
    },
  );

  app.get(
    "/api/v1/deals/:dealId/settlement/:settlementId/reconciliation",
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: "object",
          properties: {
            dealId: { type: "string", format: "uuid" },
            settlementId: { type: "string", format: "uuid" },
          },
          required: ["dealId", "settlementId"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              reconciliation: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId, settlementId } = request.params as {
        dealId: string;
        settlementId: string;
      };
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.SettlementRead);

      const reconciliation = await getReconciliationBySettlement(viewer.organizationId, settlementId);

      return reply.send({ reconciliation });
    },
  );

  app.get(
    "/api/v1/deals/:dealId/reconciliation/:reconciliationId",
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: "object",
          properties: {
            dealId: { type: "string", format: "uuid" },
            reconciliationId: { type: "string", format: "uuid" },
          },
          required: ["dealId", "reconciliationId"],
        },
        response: {
          200: {
            type: "object",
            properties: {
              reconciliation: { type: "object", additionalProperties: true },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId, reconciliationId } = request.params as {
        dealId: string;
        reconciliationId: string;
      };
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.SettlementRead);

      const reconciliation = await getReconciliation(viewer.organizationId, reconciliationId);

      return reply.send({ reconciliation });
    },
  );

  app.get(
    "/api/v1/deals/:dealId/reconciliation",
    {
      preHandler: [app.authenticate],
      schema: {
        params: {
          type: "object",
          properties: { dealId: { type: "string", format: "uuid" } },
          required: ["dealId"],
        },
        querystring: {
          type: "object",
          properties: {
            page: { type: "integer", minimum: 1, default: 1 },
            limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            status: { type: "string" },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              reconciliations: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
              page: { type: "integer" },
              limit: { type: "integer" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId } = request.params as { dealId: string };
      const query = request.query as {
        page?: number;
        limit?: number;
        status?: string;
      };
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.SettlementRead);

      const result = await listReconciliations(viewer.organizationId, {
        page: query.page,
        limit: query.limit,
        status: query.status,
        dealId,
      });

      return reply.send(result);
    },
  );
}