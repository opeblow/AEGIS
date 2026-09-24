import type { Deal, Prisma } from "@prisma/client";
import { currencyInfo } from "../deals/deal.schemas.js";
import {
  transactionRouteProblemSchema,
  type QuantumProblem,
  type ConstraintsInput,
  type ObjectiveWeightsInput,
  type RouteCandidateInput,
} from "./quantum.schemas.js";

/**
 * Builds the quantum optimization problem for `deal` from client-supplied
 * candidate routes.
 *
 * Authoritative-field boundary:
 *   - `transaction_amount` is ALWAYS the deal's notional amount, serialized as
 *     an exact ISO 4217 minor-unit string (never a float). The client cannot
 *     influence the amount being optimized.
 *   - Candidate routes / constraints / objective weights come from the caller
 *     (the deal has no route concept), but every cross-field invariant is
 *     re-validated here so a mapping bug is caught BEFORE the network.
 *
 * The assembled problem is validated against the strict mirror of the
 * upstream `TransactionRouteProblem` schema before it returns.
 */

export interface OptimizationProblemInput {
  routes: RouteCandidateInput[];
  constraints?: ConstraintsInput;
  objectiveWeights?: ObjectiveWeightsInput;
}

export function buildOptimizationProblem(
  deal: Deal,
  input: OptimizationProblemInput,
): QuantumProblem {
  const constraints = input.constraints ?? {};
  const weights = input.objectiveWeights ?? {};

  const assembled = {
    transaction_amount: toMoneyString(deal.notionalAmount, deal.currency),
    routes: input.routes.map((route) => ({
      id: route.id,
      cost: route.cost,
      risk: route.risk,
      liquidity: route.liquidity,
      capacity: route.capacity,
      available: route.available,
    })),
    constraints: {
      max_cost: constraints.maxCost ?? null,
      max_risk: constraints.maxRisk ?? null,
      min_selected_routes: constraints.minSelectedRoutes ?? 1,
      max_selected_routes: constraints.maxSelectedRoutes ?? null,
      required_route_ids: constraints.requiredRouteIds ?? [],
    },
    objective_weights: {
      cost: weights.cost ?? 1,
      risk: weights.risk ?? 1,
      selection: weights.selection ?? 0,
    },
  };

  // Strict, mirror-of-upstream validation plus cross-field invariants: a
  // projection bug fails HERE, before anything crosses the network.
  assertCrossFieldConsistency(assembled);
  return transactionRouteProblemSchema.parse(assembled);
}

/** Exact ISO 4217 minor-unit money string; never a float. */
export function toMoneyString(amount: Prisma.Decimal, currency: string): string {
  const { minor } = currencyInfo(currency);
  return amount.toFixed(minor);
}

/**
 * Cross-field invariants from the request-body layer, re-applied to the
 * ASSEMBLED (snake_case) problem so a mapping/rebuild bug fails before the
 * network even if a future caller skips request-body validation.
 */
function assertCrossFieldConsistency(problem: {
  routes: Array<{ id: string }>;
  constraints: {
    min_selected_routes: number;
    max_selected_routes: number | null;
    required_route_ids: string[];
  };
}): void {
  const { routes, constraints } = problem;
  const routeIds = new Set(routes.map((route) => route.id));
  if (routeIds.size !== routes.length) {
    throw Error("Cross-field invariant failed: route ids must be unique.");
  }
  for (const id of constraints.required_route_ids) {
    if (!routeIds.has(id)) {
      throw Error("Cross-field invariant failed: required route ids must reference existing routes.");
    }
  }
  const minSelected = constraints.min_selected_routes;
  const maxSelected = constraints.max_selected_routes;
  if (maxSelected !== null && maxSelected < minSelected) {
    throw Error("Cross-field invariant failed: maxSelectedRoutes cannot be less than minSelectedRoutes.");
  }
  if (maxSelected !== null && maxSelected > routes.length) {
    throw Error("Cross-field invariant failed: maxSelectedRoutes cannot exceed the number of routes.");
  }
}