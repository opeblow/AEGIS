import type { DealOptimizationRun } from "@prisma/client";
import type {
  OptimizationOperationValue,
  OptimizationRunStatus,
  QuantumComparison,
  QuantumSolverResult,
} from "./quantum.schemas.js";

/**
 * Public representation of a stored optimization run. Results are advisory:
 * they never gate or mutate authoritative deal/approval/settlement state.
 */
export interface OptimizationMetricsSummary {
  feasible: boolean;
  selectedRoutes: number;
  solverType: string;
  problemId: string;
  /** Exact objective value as serialized by the service (decimal string). */
  objectiveValue: string | null;
}

export type OptimizationResult = QuantumSolverResult | QuantumComparison;

export interface PublicDealOptimizationRun {
  id: string;
  dealId: string;
  organizationId: string;
  status: OptimizationRunStatus;
  operation: OptimizationOperationValue;
  optimizationVersion: string | null;
  solver: string | null;
  problemId: string | null;
  /** Backend-computed SHA-256 of the canonical problem payload. */
  inputHash: string;
  result: OptimizationResult | null;
  metrics: OptimizationMetricsSummary | null;
  errorCode: string | null;
  requestedByUserId: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function isComparisonResult(
  result: OptimizationResult | null | undefined,
): result is QuantumComparison {
  return (
    result !== null &&
    typeof result === "object" &&
    "classical" in result &&
    "quantum" in result
  );
}

export function toPublicRun(
  run: DealOptimizationRun,
): PublicDealOptimizationRun {
  return {
    id: run.id,
    dealId: run.dealId,
    organizationId: run.organizationId,
    status: run.status,
    operation: run.operation as PublicDealOptimizationRun["operation"],
    optimizationVersion: run.optimizationVersion,
    solver: run.solver,
    problemId: run.problemId,
    inputHash: run.inputHash,
    result: (run.result ?? null) as OptimizationResult | null,
    metrics: (run.metrics ?? null) as OptimizationMetricsSummary | null,
    errorCode: run.errorCode,
    requestedByUserId: run.requestedByUserId,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}