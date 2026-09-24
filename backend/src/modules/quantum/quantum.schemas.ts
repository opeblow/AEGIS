import { z } from "zod";

/**
 * Quantum Optimization (Phase 10) schemas.
 *
 * The backend is the ONLY client of the quantum optimization service
 * ("quantum computing/", a FastAPI app). Its request validation uses
 * `extra="forbid"`, so an unknown key is a 422; the outgoing problem schema
 * below mirrors `app/schemas/problem.py` field for field and is `.strict()`
 * so a mapper bug is caught BEFORE it reaches the wire.
 *
 * The incoming response schemas mirror `app/schemas/output.py`. The quantum
 * service validates its own responses with `extra="forbid"`, but we parse with
 * `.passthrough()` so the backend is forward-compatible if the service adds
 * fields, while still validating every field the backend consumes.
 *
 * Decimal fields (objective_value, allocations, coefficients, ...) are
 * accepted as strings OR numbers: Pydantic/FastAPI serialization of Decimal
 * historically varies between the two across versions. Accepting both makes
 * the client robust without guessing the service's serializer.
 */

// ---------------------------------------------------------------------------
// Route params + shared literals
// ---------------------------------------------------------------------------

export const dealIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
});

export const runIdParamsSchema = z.object({
  dealId: z.string().uuid({ message: "dealId must be a valid UUID" }),
  runId: z.string().uuid({ message: "runId must be a valid UUID" }),
});

export const DEAL_OPTIMIZATION_RUN_STATUSES = [
  "PENDING",
  "COMPLETED",
  "FAILED",
] as const;

export const OptimizationOperation = {
  Optimize: "OPTIMIZE",
  Compare: "COMPARE",
} as const;

export type OptimizationOperationValue =
  (typeof OptimizationOperation)[keyof typeof OptimizationOperation];

export const SOLVER_NAMES = ["classical", "simulator", "real_hardware"] as const;

export const solverNameSchema = z.enum(SOLVER_NAMES);
export type SolverName = z.infer<typeof solverNameSchema>;

export const listRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(DEAL_OPTIMIZATION_RUN_STATUSES).optional(),
  operation: z.enum([
    OptimizationOperation.Optimize,
    OptimizationOperation.Compare,
  ]).optional(),
});

// ---------------------------------------------------------------------------
// Incoming request bodies (client-facing, camelCase)
// ---------------------------------------------------------------------------

/** Route id pattern mirrors `app/schemas/problem.py::RouteCandidate.id`. */
const routeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, "invalid route id");

const routeCandidateBodySchema = z.object({
  id: routeIdSchema,
  cost: z.number().nonnegative("cost must be >= 0"),
  risk: z.number().min(0).max(1, "risk must be within [0, 1]"),
  liquidity: z.number().positive("liquidity must be > 0"),
  capacity: z.number().positive("capacity must be > 0"),
  available: z.boolean(),
});

const constraintsBodySchema = z.object({
  maxCost: z.number().nonnegative().optional(),
  maxRisk: z.number().min(0).max(1).optional(),
  minSelectedRoutes: z.number().int().min(1).optional(),
  maxSelectedRoutes: z.number().int().min(1).optional(),
  requiredRouteIds: z.array(routeIdSchema).optional(),
});

const objectiveWeightsBodySchema = z
  .object({
    cost: z.number().nonnegative().optional(),
    risk: z.number().nonnegative().optional(),
    selection: z.number().nonnegative().optional(),
  })
  .refine(
    (weights) =>
      (weights.cost ?? 1) + (weights.risk ?? 1) + (weights.selection ?? 0) > 0,
    "at least one objective weight must be positive",
  );

function addProblemShapeIssues(
  value: {
    routes: Array<{ id: string }>;
    constraints?: {
      minSelectedRoutes?: number;
      maxSelectedRoutes?: number;
      requiredRouteIds?: string[];
    };
  },
  ctx: z.RefinementCtx,
): void {
  const { routes, constraints } = value;
  const routeIds = new Set(routes.map((route) => route.id));
  if (routeIds.size !== routes.length) {
    ctx.addIssue({ code: "custom", message: "route ids must be unique" });
  }

  const required = constraints?.requiredRouteIds ?? [];
  if (new Set(required).size !== required.length) {
    ctx.addIssue({ code: "custom", message: "required route ids must be unique" });
  }
  for (const id of required) {
    if (!routeIds.has(id)) {
      ctx.addIssue({
        code: "custom",
        message: "required route ids must reference existing routes",
      });
    }
  }

  const minSelected = constraints?.minSelectedRoutes ?? 1;
  const maxSelected = constraints?.maxSelectedRoutes;
  if (maxSelected !== undefined && maxSelected < minSelected) {
    ctx.addIssue({
      code: "custom",
      message: "maxSelectedRoutes cannot be less than minSelectedRoutes",
    });
  }
  if (maxSelected !== undefined && maxSelected > routes.length) {
    ctx.addIssue({
      code: "custom",
      message: "maxSelectedRoutes cannot exceed the number of routes",
    });
  }
}

export const optimizeRequestBodySchema = z
  .object({
    routes: z.array(routeCandidateBodySchema).min(1, "at least one route is required").max(100),
    constraints: constraintsBodySchema.optional(),
    objectiveWeights: objectiveWeightsBodySchema.optional(),
    solver: solverNameSchema.optional(),
  })
  .superRefine(addProblemShapeIssues);

export const compareRequestBodySchema = z
  .object({
    routes: z.array(routeCandidateBodySchema).min(1, "at least one route is required").max(100),
    constraints: constraintsBodySchema.optional(),
    objectiveWeights: objectiveWeightsBodySchema.optional(),
    quantumSolver: solverNameSchema.optional(),
  })
  .superRefine(addProblemShapeIssues);

export type RouteCandidateInput = z.infer<typeof routeCandidateBodySchema>;
export type ConstraintsInput = z.infer<typeof constraintsBodySchema>;
export type ObjectiveWeightsInput = z.infer<typeof objectiveWeightsBodySchema>;
export type OptimizeRequestBody = z.infer<typeof optimizeRequestBodySchema>;
export type CompareRequestBody = z.infer<typeof compareRequestBodySchema>;

/**
 * Strict mirror of the upstream problem wire format (snake_case).
 * `transaction_amount` is exact minor-unit money from the deal (a string,
 * never a float) — injected by the mapper, never trusted from the client.
 */
export const routeCandidateSchema = z.object({
  id: routeIdSchema,
  cost: z.number().nonnegative(),
  risk: z.number().min(0).max(1),
  liquidity: z.number().positive(),
  capacity: z.number().positive(),
  available: z.boolean(),
}).strict();

export const routeConstraintsSchema = z.object({
  max_cost: z.number().nonnegative().nullable().optional(),
  max_risk: z.number().min(0).max(1).nullable().optional(),
  min_selected_routes: z.number().int().min(1).default(1),
  max_selected_routes: z.number().int().min(1).nullable().optional(),
  required_route_ids: z.array(routeIdSchema).default([]),
}).strict();

export const objectiveWeightsSchema = z.object({
  cost: z.number().nonnegative().default(1),
  risk: z.number().nonnegative().default(1),
  selection: z.number().nonnegative().default(0),
}).strict();

const moneyStr = z
  .string()
  .min(1)
  .regex(/^\d+(\.\d+)?$/, "amount must be a non-negative decimal string");

export const transactionRouteProblemSchema = z
  .object({
    transaction_amount: moneyStr,
    routes: z.array(routeCandidateSchema).min(1).max(100),
    constraints: routeConstraintsSchema,
    objective_weights: objectiveWeightsSchema,
  })
  .strict();

export type QuantumProblem = z.infer<typeof transactionRouteProblemSchema>;

// ---------------------------------------------------------------------------
// Incoming response validation (mirrors output.py; extra fields pass through)
// ---------------------------------------------------------------------------

/** Decimal values arrive as numbers or non-negative decimal strings. */
const decimalNum = z.union([
  z.number(),
  z.string().regex(/^\d+(\.\d+)?$/, "decimal must be a non-negative decimal string"),
]);

const formulationMetadataSchema = z
  .object({
    formulation_type: z.literal("QUBO"),
    num_binary_variables: z.number().int(),
    num_route_variables: z.number().int(),
    num_slack_variables: z.number().int(),
    num_constraints: z.number().int(),
    precision_scale: z.number().int(),
    penalty_coefficient: decimalNum,
    constraint_encoding: z.string().default("bounded binary slack registers"),
  })
  .passthrough();

const executionMetadataSchema = z
  .object({
    backend: z.string(),
    algorithm: z.string(),
    deterministic: z.boolean(),
    seed: z.number().int().nullable().optional(),
    shots: z.number().int().nullable().optional(),
    layers: z.number().int().nullable().optional(),
    statevector_variables: z.number().int().nullable().optional(),
    fallback: z.string().nullable().optional(),
    provider: z.string().nullable().optional(),
    hardware_backend: z.string().nullable().optional(),
    execution_date: z.string().nullable().optional(),
    qubits: z.number().int().nullable().optional(),
    note: z.string().nullable().optional(),
  })
  .passthrough();

const routeAllocationSchema = z
  .object({
    route_id: z.string(),
    amount: decimalNum,
  })
  .passthrough();

export const solverResultSchema = z
  .object({
    problem_id: z.string().min(1),
    solver_type: z.string().min(1),
    feasible: z.boolean(),
    selected_variables: z.record(z.string(), z.number()),
    selected_routes: z.array(z.string()),
    allocations: z.array(routeAllocationSchema),
    objective_value: decimalNum,
    energy: z.number(),
    constraint_violations: z.array(z.string()),
    formulation_metadata: formulationMetadataSchema,
    execution_metadata: executionMetadataSchema,
    confidence: z.number().nullable().optional(),
  })
  .passthrough();

export const comparisonResponseSchema = z
  .object({
    problem_id: z.string().min(1),
    classical: solverResultSchema,
    quantum: solverResultSchema,
    objective_delta: decimalNum.nullable().optional(),
    better_solver: z.enum(["classical", "quantum", "tie", "not_comparable"]),
    same_feasibility: z.boolean(),
    claim: z.string(),
  })
  .passthrough();

export type QuantumSolverResult = z.infer<typeof solverResultSchema>;
export type QuantumComparison = z.infer<typeof comparisonResponseSchema>;
export type OptimizationRunStatus =
  (typeof DEAL_OPTIMIZATION_RUN_STATUSES)[number];