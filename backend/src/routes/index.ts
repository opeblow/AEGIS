import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import healthRoutes from "./health/health.route.js";
import { organizationsRoutes } from "../modules/organizations/index.js";
import { dealRoutes } from "../modules/deals/index.js";
import { negotiationRoutes } from "../modules/negotiation/index.js";
import {
  documentRoutes,
  requirementRoutes,
} from "../modules/documents/index.js";
import { approvalRoutes } from "../modules/approvals/index.js";
import {
  settlementRoutes,
  reconciliationRoutes,
} from "../modules/settlement/index.js";
import { aiRoutes } from "../modules/ai/index.js";
import { quantumRoutes } from "../modules/quantum/index.js";
import { oneswapRoutes } from "../modules/oneswap/index.js";

/**
 * Aggregates all API routes under the `/api/v1` namespace. Business modules
 * (deals, approvals, offers, ...) are registered here as they ship.
 */
const routes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  void app.register(healthRoutes, { prefix: "/api/v1" });
  void app.register(organizationsRoutes, { prefix: "/api/v1" });
  void app.register(dealRoutes, { prefix: "/api/v1" });
  void app.register(negotiationRoutes, { prefix: "/api/v1" });
  void app.register(documentRoutes, { prefix: "/api/v1" });
  void app.register(requirementRoutes, { prefix: "/api/v1" });
  void app.register(approvalRoutes, { prefix: "/api/v1" });
  void app.register(settlementRoutes);
  void app.register(reconciliationRoutes);
  void app.register(aiRoutes, { prefix: "/api/v1" });
  void app.register(quantumRoutes, { prefix: "/api/v1" });
  void app.register(oneswapRoutes, { prefix: "/api/v1" });
  done();
};

export default routes;
