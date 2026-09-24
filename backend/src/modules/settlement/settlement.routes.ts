import type { FastifyInstance, FastifyRequest } from "fastify";
import { authorize, actorUserId } from "../organizations/authorization.service.js";
import { Permissions } from "../organizations/permissions.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import { resolveDealViewer } from "../negotiation/participant-policy.js";
import {
  initiateSettlement,
  submitSettlement,
  getSettlementStatus,
  cancelSettlement,
  listSettlements,
  getSettlementHistory,
} from "./settlement.service.js";

function extractRequestMeta(request: FastifyRequest): RequestMeta {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

export async function settlementRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/v1/deals/:dealId/settlement",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      schema: {
        params: {
          type: "object",
          properties: { dealId: { type: "string", format: "uuid" } },
          required: ["dealId"],
        },
        body: {
          type: "object",
          properties: {
            idempotencyKey: { type: "string", minLength: 1, maxLength: 256 },
            requestId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["idempotencyKey"],
        },
        response: {
          201: {
            type: "object",
            properties: {
              settlement: { type: "object", additionalProperties: true },
              transition: { type: "object", additionalProperties: true },
              replay: { type: "boolean" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { dealId } = request.params as { dealId: string };
      const userId = actorUserId(request);
      const viewer = await resolveDealViewer(dealId, userId);
      await authorize(request, viewer.organizationId, Permissions.SettlementExecute);
      const meta = extractRequestMeta(request);

      const result = await initiateSettlement(viewer.organizationId, dealId, request.body, userId, meta);

      return reply.code(201).send(result);
    },
  );

  app.post(
    "/api/v1/deals/:dealId/settlement/:settlementId/submit",
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
        response: {
          200: {
            type: "object",
            properties: {
              settlement: { type: "object", additionalProperties: true },
              transition: { type: "object", additionalProperties: true },
              replay: { type: "boolean" },
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

      const result = await submitSettlement(viewer.organizationId, settlementId, userId, meta);

      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/deals/:dealId/settlement",
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
              settlements: { type: "array", items: { type: "object", additionalProperties: true } },
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

      const result = await listSettlements(viewer.organizationId, {
        page: query.page,
        limit: query.limit,
        status: query.status,
        dealId,
      });

      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/deals/:dealId/settlement/:settlementId",
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
              settlement: { type: "object", additionalProperties: true },
              transition: { type: "object", additionalProperties: true },
              replay: { type: "boolean" },
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
      await authorize(request, viewer.organizationId, Permissions.SettlementRead);

      const result = await getSettlementStatus(viewer.organizationId, settlementId, userId);

      return reply.send(result);
    },
  );

  app.get(
    "/api/v1/deals/:dealId/settlement/:settlementId/history",
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
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              transitions: { type: "array", items: { type: "object", additionalProperties: true } },
              total: { type: "integer" },
              limit: { type: "integer" },
              offset: { type: "integer" },
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
      const query = request.query as { limit?: number; offset?: number };
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      await authorize(request, viewer.organizationId, Permissions.SettlementRead);

      const result = await getSettlementHistory(viewer.organizationId, settlementId, {
        limit: query.limit,
        offset: query.offset,
      });

      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/deals/:dealId/settlement/:settlementId/cancel",
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
        response: {
          200: {
            type: "object",
            properties: {
              settlement: { type: "object", additionalProperties: true },
              transition: { type: "object", additionalProperties: true },
              replay: { type: "boolean" },
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

      const result = await cancelSettlement(viewer.organizationId, settlementId, userId, meta);

      return reply.send(result);
    },
  );
}

export const SETTLEMENT_PERMISSIONS = [
  Permissions.SettlementExecute,
  Permissions.SettlementRead,
] as const;