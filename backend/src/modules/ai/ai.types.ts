import type { DealIntelligenceRun } from "@prisma/client";
import type {
  DealIntelligenceResult,
  IntelligenceRunStatus,
} from "./ai.schemas.js";

/**
 * Public representation of a stored intelligence run. Results are advisory:
 * they never gate or mutate authoritative deal/approval/settlement state.
 */
export interface ConfidenceSummary {
  confidence: number;
  riskFlags: number;
  blockers: number;
  documentFindings: number;
  modelSummary: boolean;
}

export interface PublicDealIntelligenceRun {
  id: string;
  dealId: string;
  organizationId: string;
  status: IntelligenceRunStatus;
  provider: string | null;
  modelVersion: string | null;
  analysisVersion: string | null;
  /** Backend-computed SHA-256 of the canonical context payload. */
  inputHash: string;
  result: DealIntelligenceResult | null;
  confidenceSummary: ConfidenceSummary | null;
  errorCode: string | null;
  requestedByUserId: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toPublicRun(run: DealIntelligenceRun): PublicDealIntelligenceRun {
  return {
    id: run.id,
    dealId: run.dealId,
    organizationId: run.organizationId,
    status: run.status,
    provider: run.provider,
    modelVersion: run.modelVersion,
    analysisVersion: run.analysisVersion,
    inputHash: run.inputHash,
    result: (run.result ?? null) as DealIntelligenceResult | null,
    confidenceSummary: (run.confidenceSummary ?? null) as ConfidenceSummary | null,
    errorCode: run.errorCode,
    requestedByUserId: run.requestedByUserId,
    completedAt: run.completedAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}