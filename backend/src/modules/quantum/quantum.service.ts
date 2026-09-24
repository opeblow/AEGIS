import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { stableStringify } from "../../lib/stable-stringify.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import {
  recordSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import {
  getQuantumClient,
  type QuantumClient,
  type ComparePayload,
  type OptimizePayload,
} from "./quantum.client.js";
import { buildOptimizationProblem } from "./quantum.mapper.js";
import {
  OptimizationOperation,
  type CompareRequestBody,
  type OptimizeRequestBody,
  type QuantumProblem,
} from "./quantum.schemas.js";
import {
  isComparisonResult,
  toPublicRun,
  type OptimizationMetricsSummary,
  type PublicDealOptimizationRun,
} from "./quantum.types.js";

/**
 * Quantum Optimization (Phase 10) — orchestration.
 *
 * Idempotency model ("avoid unlimited duplicate runs"):
 *   - A COMPLETED run whose `inputHash` equals the current request's hash is
 *     REPLAYED (returned as-is) instead of calling the quantum service again.
 *   - A PENDING run for this deal is returned (still in flight).
 *   - Otherwise a PENDING run is created, the service is called, and the run
 *     is marked COMPLETED (with the strict-validated result) or FAILED (with
 *     a stable QUANTUM_* errorCode). Failed runs retry on the next request.
 *
 * The canonical hash covers the assembled problem, the operation, the
 * requested solver, AND the acting organization — so identical inputs from
 * different participant organizations never replay each other's run, and a
 * rerun with a different solver/constraint set is a distinct run. An
 * identical-hash request under concurrency can create duplicate PENDING rows
 * (no DB uniqueness on inputHash); the replay rule bounds the cost to a
 * single redundant provider call. Runs are append-only history and never
 * mutate authoritative deal state.
 */

export const QUANTUM_CLIENT_VERSION = "1.0";
export const QUANTUM_OPTIMIZATION_VERSION = "1.0";

export interface OptimizationOutcome {
  run: PublicDealOptimizationRun;
  replayed: boolean;
}

export interface OptimizationRunQuery {
  limit: number;
  offset: number;
  status?: "PENDING" | "COMPLETED" | "FAILED";
  operation?: "OPTIMIZE" | "COMPARE";
}

export async function runDealOptimization(
  viewer: DealViewer,
  dealId: string,
  operation: "OPTIMIZE" | "COMPARE",
  body: OptimizeRequestBody | CompareRequestBody,
  actorUserId: string,
  meta: RequestMeta,
  deps: { client?: QuantumClient } = {},
): Promise<OptimizationOutcome> {
  const client = deps.client ?? getQuantumClient();
  const problem = buildOptimizationProblem(viewer.deal, body);

  const requestedSolver =
    operation === OptimizationOperation.Optimize
      ? (body as OptimizeRequestBody).solver ?? null
      : (body as CompareRequestBody).quantumSolver ?? null;

  const inputHash = canonicalProblemHash({
    operation,
    solver: requestedSolver,
    organizationId: viewer.organizationId,
    problem,
  });

  const completed = await prisma.dealOptimizationRun.findFirst({
    where: { dealId, status: "COMPLETED", inputHash },
    orderBy: { createdAt: "desc" },
  });
  if (completed) {
    return { run: toPublicRun(completed), replayed: true };
  }

  const pending = await prisma.dealOptimizationRun.findFirst({
    where: { dealId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    return { run: toPublicRun(pending), replayed: true };
  }

  const run = await prisma.dealOptimizationRun.create({
    data: {
      organizationId: viewer.organizationId,
      dealId,
      requestedByUserId: actorUserId,
      status: "PENDING",
      operation,
      optimizationVersion: QUANTUM_OPTIMIZATION_VERSION,
      inputHash,
    },
  });

  await recordSecurityEvent({
    type: SecurityEventType.DEAL_OPTIMIZATION_REQUESTED,
    userId: actorUserId,
    organizationId: viewer.organizationId,
    metadata: { dealId, runId: run.id, operation, inputHash },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  try {
    const outcome =
      operation === OptimizationOperation.Optimize
        ? await client.optimize({
            problem,
            ...(requestedSolver ? { solver: requestedSolver } : {}),
          } as OptimizePayload)
        : await client.compare({
            problem,
            ...(requestedSolver ? { quantumSolver: requestedSolver } : {}),
          } as ComparePayload);

    const { result, problemId } = outcome;
    if (!problemId) {
      throw AppError.quantumInvalidResponse(
        "The quantum service answered without a problem id.",
      );
    }

    const solver = isComparisonResult(result)
      ? (requestedSolver ?? result.quantum.solver_type)
      : requestedSolver ?? result.solver_type;

    const metrics: OptimizationMetricsSummary = isComparisonResult(result)
      ? metricsForSolver(result.quantum)
      : metricsForSolver(result);

    const updated = await prisma.dealOptimizationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        solver,
        problemId,
        result: result as unknown as Prisma.InputJsonValue,
        metrics: metrics as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await recordSecurityEvent({
      type: SecurityEventType.DEAL_OPTIMIZATION_COMPLETED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { dealId, runId: run.id, operation, problemId, inputHash },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { run: toPublicRun(updated), replayed: false };
  } catch (cause) {
    const errorCode =
      cause instanceof AppError ? cause.code : "QUANTUM_OPTIMIZATION_FAILED";
    const safeError =
      cause instanceof AppError
        ? cause
        : AppError.quantumOptimizationFailed(undefined, cause);

    await prisma.dealOptimizationRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorCode,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    await recordSecurityEvent({
      type: SecurityEventType.DEAL_OPTIMIZATION_FAILED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { dealId, runId: run.id, operation, errorCode },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    throw safeError;
  }
}

export async function listOptimizationRuns(
  viewer: DealViewer,
  dealId: string,
  query: OptimizationRunQuery,
): Promise<{ runs: PublicDealOptimizationRun[]; total: number; limit: number; offset: number }> {
  const where: Prisma.DealOptimizationRunWhereInput = {
    dealId,
    organizationId: viewer.organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.operation ? { operation: query.operation } : {}),
  };
  const [runs, total] = await prisma.$transaction([
    prisma.dealOptimizationRun.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
    }),
    prisma.dealOptimizationRun.count({ where }),
  ]);
  return {
    runs: runs.map(toPublicRun),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getOptimizationRun(
  viewer: DealViewer,
  dealId: string,
  runId: string,
): Promise<{ run: PublicDealOptimizationRun }> {
  const run = await prisma.dealOptimizationRun.findFirst({
    where: { id: runId, dealId, organizationId: viewer.organizationId },
  });
  if (!run) throw AppError.quantumOptimizationNotFound();
  return { run: toPublicRun(run) };
}

/**
 * SHA-256 of the canonical, key-sorted serialization of everything that
 * defines an optimization request: the operation, the requested solver, the
 * acting organization (tenant isolation), and the fully-serialized problem.
 */
export function canonicalProblemHash(canonical: {
  operation: "OPTIMIZE" | "COMPARE";
  solver: string | null;
  organizationId: string;
  problem: QuantumProblem;
}): string {
  return createHash("sha256")
    .update(stableStringify(canonical))
    .digest("hex");
}

/** Lightweight projection for list views. */
function metricsForSolver(result: {
  problem_id: string;
  solver_type: string;
  feasible: boolean;
  selected_routes: string[];
  objective_value: number | string;
}): OptimizationMetricsSummary {
  return {
    feasible: result.feasible,
    selectedRoutes: result.selected_routes.length,
    solverType: result.solver_type,
    problemId: result.problem_id,
    objectiveValue: decimalToDisplayString(result.objective_value),
  };
}

function decimalToDisplayString(value: number | string): string {
  return typeof value === "number" ? String(value) : value;
}