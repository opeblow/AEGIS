import type {
  Settlement,
  SettlementTransition,
  Reconciliation,
} from "@prisma/client";

export type SettlementStatus =
  | "CREATED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED";

export type SettlementProviderType = "CANTON" | "MOCK";

export const SETTLEMENT_STATUSES = [
  "CREATED",
  "SUBMITTING",
  "SUBMITTED",
  "PENDING",
  "SETTLED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
] as const satisfies readonly SettlementStatus[];

export type ReconciliationStatus =
  | "PENDING"
  | "MATCHED"
  | "MISMATCHED"
  | "FAILED"
  | "RESOLVED";

export const RECONCILIATION_STATUSES = [
  "PENDING",
  "MATCHED",
  "MISMATCHED",
  "FAILED",
  "RESOLVED",
] as const satisfies readonly ReconciliationStatus[];

export type SettlementProviderSubmitResult = {
  providerReference: string;
  externalTransactionId?: string;
  status: SettlementStatus;
  submittedAt: Date;
};

export type SettlementProviderStatusResult = {
  providerReference: string;
  externalTransactionId?: string;
  status: SettlementStatus;
  rawResponse?: unknown;
  checkedAt: Date;
};

export interface SettlementProviderInterface {
  readonly name: SettlementProviderType;
  submit(
    settlementId: string,
    payload: SettlementSubmissionPayload,
  ): Promise<SettlementProviderSubmitResult>;
  getStatus(providerReference: string): Promise<SettlementProviderStatusResult>;
  cancel?(providerReference: string): Promise<void>;
}

export interface SettlementSubmissionPayload {
  dealId: string;
  organizationId: string;
  amount: string;
  currency: string;
  assetIdentifier?: string;
  metadata?: Record<string, unknown>;
}

export interface PublicSettlement {
  id: string;
  dealId: string;
  organizationId: string;
  provider: SettlementProviderType;
  providerReference: string | null;
  externalTransactionId: string | null;
  status: SettlementStatus;
  amount: string;
  currency: string;
  assetIdentifier: string | null;
  initiatedByUserId: string;
  initiatedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicSettlementTransition {
  id: string;
  settlementId: string;
  dealId: string;
  organizationId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: SettlementStatus;
  toStatus: SettlementStatus;
  reason: string | null;
  actorUserId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface PublicReconciliation {
  id: string;
  dealId: string;
  settlementId: string;
  organizationId: string;
  expectedAmount: string;
  actualAmount: string | null;
  expectedCurrency: string;
  actualCurrency: string | null;
  expectedReference: string | null;
  actualReference: string | null;
  expectedState: string;
  actualState: string | null;
  status: ReconciliationStatus;
  mismatchReason: string | null;
  checkedAt: string;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  resolutionReason: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export function toPublicSettlement(
  settlement: Settlement & { transitions?: SettlementTransition[] },
): PublicSettlement {
  return {
    id: settlement.id,
    dealId: settlement.dealId,
    organizationId: settlement.organizationId,
    provider: settlement.provider,
    providerReference: settlement.providerReference,
    externalTransactionId: settlement.externalTransactionId,
    status: settlement.status,
    amount: settlement.amount.toString(),
    currency: settlement.currency,
    assetIdentifier: settlement.assetIdentifier,
    initiatedByUserId: settlement.initiatedByUserId,
    initiatedAt: settlement.initiatedAt.toISOString(),
    submittedAt: settlement.submittedAt?.toISOString() ?? null,
    completedAt: settlement.completedAt?.toISOString() ?? null,
    failedAt: settlement.failedAt?.toISOString() ?? null,
    failureReason: settlement.failureReason,
    metadata: (settlement.metadata as Record<string, unknown>) ?? null,
    createdAt: settlement.createdAt.toISOString(),
    updatedAt: settlement.updatedAt.toISOString(),
  };
}

export function toPublicSettlementTransition(
  transition: SettlementTransition,
): PublicSettlementTransition {
  return {
    id: transition.id,
    settlementId: transition.settlementId,
    dealId: transition.dealId,
    organizationId: transition.organizationId,
    requestId: transition.requestId,
    transitionType: transition.transitionType,
    fromStatus: transition.fromStatus,
    toStatus: transition.toStatus,
    reason: transition.reason,
    actorUserId: transition.actorUserId,
    metadata: (transition.metadata as Record<string, unknown>) ?? null,
    createdAt: transition.createdAt.toISOString(),
  };
}

export function toPublicReconciliation(
  reconciliation: Reconciliation,
): PublicReconciliation {
  return {
    id: reconciliation.id,
    dealId: reconciliation.dealId,
    settlementId: reconciliation.settlementId,
    organizationId: reconciliation.organizationId,
    expectedAmount: reconciliation.expectedAmount.toString(),
    actualAmount: reconciliation.actualAmount?.toString() ?? null,
    expectedCurrency: reconciliation.expectedCurrency,
    actualCurrency: reconciliation.actualCurrency ?? null,
    expectedReference: reconciliation.expectedReference,
    actualReference: reconciliation.actualReference,
    expectedState: reconciliation.expectedState,
    actualState: reconciliation.actualState,
    status: reconciliation.status,
    mismatchReason: reconciliation.mismatchReason,
    checkedAt: reconciliation.checkedAt.toISOString(),
    resolvedAt: reconciliation.resolvedAt?.toISOString() ?? null,
    resolvedByUserId: reconciliation.resolvedByUserId ?? null,
    resolutionReason: reconciliation.resolutionReason,
    metadata: (reconciliation.metadata as Record<string, unknown>) ?? null,
    createdAt: reconciliation.createdAt.toISOString(),
    updatedAt: reconciliation.updatedAt.toISOString(),
  };
}