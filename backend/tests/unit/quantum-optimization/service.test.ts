import { describe, expect, it } from "vitest";
import type { Deal } from "@prisma/client";
import { buildOptimizationProblem } from "../../../src/modules/quantum/quantum.mapper.js";
import {
  canonicalProblemHash,
} from "../../../src/modules/quantum/quantum.service.js";
import {
  optimizeRequestBodySchema,
  compareRequestBodySchema,
  transactionRouteProblemSchema,
  type QuantumProblem,
} from "../../../src/modules/quantum/quantum.schemas.js";
import { isComparisonResult } from "../../../src/modules/quantum/quantum.types.js";

const AMOUNT = "1250000.50";

function problemWith(overrides: Partial<QuantumProblem> = {}): QuantumProblem {
  return {
    transaction_amount: AMOUNT,
    routes: [
      { id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
      { id: "b", cost: 2, risk: 0.3, liquidity: 50, capacity: 50, available: false },
    ],
    constraints: { min_selected_routes: 1 },
    objective_weights: { cost: 1, risk: 1, selection: 0 },
    ...overrides,
  };
}

const NOTIONAL = "1,250,000.50000000";

// Build the minimal Prisma.Decimal-like object used by the mapper. The mapper
// only calls `toFixed`, so a plain number-like stub with toFixed is enough.
const notionalAmountStub = {
  toFixed(minor: number): string {
    return Number(NOTIONAL.replaceAll(",", "")).toFixed(minor);
  },
} as never;

describe("buildOptimizationProblem", () => {
  it("derives transaction_amount from the deal notional at exact ISO minor units", () => {
    const deal = { currency: "USD", notionalAmount: notionalAmountStub } as unknown as Deal;
    const problem = buildOptimizationProblem(deal, { routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }] });
    expect(problem.transaction_amount).toBe("1250000.50");
    expect(problem.transaction_amount).not.toContain(",");
  });

  it("maps constraints and objective weights to the upstream snake_case", () => {
    const deal = { currency: "USD", notionalAmount: notionalAmountStub } as unknown as Deal;
    const problem = buildOptimizationProblem(deal, {
      routes: [
        { id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
        { id: "b", cost: 2, risk: 0.3, liquidity: 50, capacity: 50, available: true },
      ],
      constraints: {
        maxCost: 2.5,
        maxRisk: 0.5,
        minSelectedRoutes: 2,
        requiredRouteIds: ["a"],
      },
      objectiveWeights: { cost: 2, selection: 1 },
    });
    expect(problem.constraints).toMatchObject({
      max_cost: 2.5,
      max_risk: 0.5,
      min_selected_routes: 2,
      required_route_ids: ["a"],
    });
    expect(problem.constraints.max_selected_routes).toBeNull();
    expect(problem.objective_weights).toEqual({ cost: 2, risk: 1, selection: 1 });
  });

  it("rejects a problem whose required route ids do not exist", () => {
    const deal = { currency: "USD", notionalAmount: notionalAmountStub } as unknown as Deal;
    expect(() =>
      buildOptimizationProblem(deal, {
        routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
        constraints: { requiredRouteIds: ["missing"] },
      }),
    ).toThrow();
  });

  it("is strict about unknown keys in the assembled problem (mirrors extra=forbid)", () => {
    const deal = { currency: "USD", notionalAmount: notionalAmountStub } as unknown as Deal;
    const problem = buildOptimizationProblem(deal, {
      routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
    });
    expect(() =>
      transactionRouteProblemSchema.parse({
        ...problem,
        unexpected_key: true,
      } as never),
    ).toThrow();
  });
});

describe("request body validation", () => {
  it("accepts a minimal optimize body", () => {
    const parsed = optimizeRequestBodySchema.parse({
      routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
    });
    expect(parsed.routes).toHaveLength(1);
    expect(parsed.solver).toBeUndefined();
  });

  it("accepts full optimize body with solver", () => {
    const parsed = optimizeRequestBodySchema.parse({
      routes: [
        { id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
        { id: "b", cost: 2, risk: 0.9, liquidity: 50, capacity: 50, available: true },
      ],
      constraints: { maxRisk: 0.8, minSelectedRoutes: 1 },
      objectiveWeights: { selection: 1 },
      solver: "simulator",
    });
    expect(parsed.solver).toBe("simulator");
    expect(parsed.constraints?.maxRisk).toBe(0.8);
  });

  it("rejects duplicate route ids", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [
          { id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
          { id: "a", cost: 2, risk: 0.2, liquidity: 50, capacity: 50, available: true },
        ],
      }),
    ).toThrow(/route ids must be unique/);
  });

  it("rejects required route ids that reference nothing", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
        constraints: { requiredRouteIds: ["nope"] },
      }),
    ).toThrow(/must reference existing routes/);
  });

  it("rejects maxSelectedRoutes below minSelectedRoutes", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
        constraints: { minSelectedRoutes: 3, maxSelectedRoutes: 1 },
      }),
    ).toThrow(/maxSelectedRoutes cannot be less than minSelectedRoutes/);
  });

  it("rejects maxSelectedRoutes above the number of routes", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
        constraints: { maxSelectedRoutes: 2 },
      }),
    ).toThrow(/maxSelectedRoutes cannot exceed the number of routes/);
  });

  it("rejects a risk outside [0, 1]", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [{ id: "a", cost: 1, risk: 1.5, liquidity: 100, capacity: 100, available: true }],
      }),
    ).toThrow(/risk/);
  });

  it("rejects all-zero objective weights", () => {
    expect(() =>
      optimizeRequestBodySchema.parse({
        routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
        objectiveWeights: { cost: 0, risk: 0 },
      }),
    ).toThrow(/at least one objective weight must be positive/);
  });

  it("rejects more than 100 routes", () => {
    const routes = Array.from({ length: 101 }, (_, index) => ({
      id: `r${index}`,
      cost: 1,
      risk: 0.1,
      liquidity: 100,
      capacity: 100,
      available: true,
    }));
    expect(() => optimizeRequestBodySchema.parse({ routes })).toThrow();
  });

  it("compare body uses quantumSolver, not solver", () => {
    const parsed = compareRequestBodySchema.parse({
      routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
      quantumSolver: "real_hardware",
    });
    expect(parsed.quantumSolver).toBe("real_hardware");

    // `solver` is a stranger to the compare schema: zod strips unknown keys,
    // so it must never reach the mapper (which reads quantumSolver).
    const withSolver = compareRequestBodySchema.parse({
      routes: [{ id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true }],
      solver: "classical",
    } as never);
    expect(withSolver).not.toHaveProperty("solver");
    expect(withSolver.quantumSolver).toBeUndefined();
  });
});

describe("canonicalProblemHash", () => {
  it("returns a 64-char hex digest", () => {
    expect(canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "a", problem: problemWith() })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of object key insertion order", () => {
    const canonical = { operation: "OPTIMIZE" as const, solver: null, organizationId: "org", problem: problemWith() };
    const reshuffled: Record<string, unknown> = {};
    for (const key of Object.keys(canonical).reverse()) reshuffled[key] = (canonical as Record<string, unknown>)[key];
    expect(canonicalProblemHash(canonical)).toBe(
      canonicalProblemHash(reshuffled as unknown as { operation: "OPTIMIZE" | "COMPARE"; solver: string | null; organizationId: string; problem: QuantumProblem }),
    );
  });

  it("separates optimize from compare", () => {
    expect(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "org", problem: problemWith() }),
    ).not.toBe(
      canonicalProblemHash({ operation: "COMPARE", solver: null, organizationId: "org", problem: problemWith() }),
    );
  });

  it("separates differing requested solvers", () => {
    expect(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: "simulator", organizationId: "org", problem: problemWith() }),
    ).not.toBe(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: "classical", organizationId: "org", problem: problemWith() }),
    );
  });

  it("keeps runs tenant-isolated (different orgs never share a hash)", () => {
    expect(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "orgA", problem: problemWith() }),
    ).not.toBe(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "orgB", problem: problemWith() }),
    );
  });

  it("changes when the problem changes", () => {
    const changed = problemWith();
    changed.routes[0].cost = 99;
    expect(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "org", problem: problemWith() }),
    ).not.toBe(
      canonicalProblemHash({ operation: "OPTIMIZE", solver: null, organizationId: "org", problem: changed }),
    );
  });
});

describe("isComparisonResult", () => {
  it("distinguishes solver results from comparisons", () => {
    expect(isComparisonResult(null as never)).toBe(false);
    expect(
      isComparisonResult({
        problem_id: "p",
        classical: {},
        quantum: {},
      } as never),
    ).toBe(true);
  });
});