/* ------------------------------------------------------------------ *
 * Aegis API type surface — mirrors the backend's public serializers. *
 * Money fields arrive as decimal strings; never coerce to number.    *
 * ------------------------------------------------------------------ */

export interface ApiUser {
  id: string;
  email: string;
  name: string | null;
  status: "ACTIVE" | "SUSPENDED" | "INVITED" | "REMOVED";
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  role: "OWNER" | "COUNTERPARTY" | "OBSERVER" | "INVITED";
  userId: string;
  status: "ACTIVE" | "SUSPENDED" | "INVITED" | "REMOVED";
  createdAt: string;
  organization?: {
    id: string;
    name: string;
    slug: string;
    legalName: string | null;
    country: string | null;
  };
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName: string | null;
  country: string | null;
  status: "ACTIVE" | "SUSPENDED";
  createdAt: string;
  updatedAt: string;
}

export type DealType = "RWA_PURCHASE" | "RWA_SALE" | "PRIVATE_TRADE" | "OTHER";

export type DealStatus =
  | "DRAFT"
  | "OPEN"
  | "NEGOTIATING"
  | "AGREED"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "RECONCILING"
  | "COMPLETED"
  | "EXPIRED"
  | "CANCELLED"
  | "FAILED"
  | "DISPUTED";

export interface PublicDeal {
  id: string;
  organizationId: string;
  createdByUserId: string;
  reference: string;
  type: DealType;
  status: DealStatus;
  name: string;
  description: string | null;
  currency: string;
  notionalAmount: string;
  settledAmount: string | null;
  settlementDate: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown> | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicDealPage {
  deals: PublicDeal[];
  total: number;
  page: number;
  limit: number;
}

export type OfferStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "COUNTERED"
  | "ACCEPTED"
  | "REJECTED"
  | "WITHDRAWN"
  | "EXPIRED"
  | "SUPERSEDED";

export interface PublicOffer {
  id: string;
  dealId: string;
  status: OfferStatus;
  version: number;
  currency: string;
  amount: string;
  price: string | null;
  settlementDate: string | null;
  expiresAt: string | null;
  submittedAt: string | null;
  parentOfferId: string | null;
  createdByParticipantId: string;
  recipientParticipantId: string;
  createdByOrganizationId: string;
  recipientOrganizationId: string;
  createdByOrganizationName: string;
  recipientOrganizationName: string;
  direction: "sent" | "received";
  createdAt: string;
  updatedAt: string;
}

export interface PublicDealParticipant {
  id: string;
  dealId: string;
  organizationId: string;
  organization: { id: string; name: string; slug: string };
  participantType: "OWNER" | "COUNTERPARTY" | "OBSERVER";
  status: "INVITED" | "ACTIVE" | "DECLINED" | "REMOVED" | "SUSPENDED";
  invitedByUserId: string | null;
  joinedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PublicRoomDeal {
  id: string;
  reference: string;
  type: DealType;
  status: DealStatus;
  name: string;
  description: string | null;
  currency: string;
  settlementDate: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  notionalAmount?: string;
  settledAmount?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface PublicDealTransition {
  id: string;
  dealId: string;
  organizationId: string;
  requestId: string | null;
  transitionType: string;
  fromStatus: DealStatus;
  toStatus: DealStatus;
  reason: string | null;
  actorUserId: string | null;
  createdAt: string;
}

export type DocumentStatus =
  | "UPLOADING"
  | "UPLOADED"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "ACCEPTED"
  | "REJECTED"
  | "EXPIRED"
  | "WITHDRAWN"
  | "SUPERSEDED";

export type DocumentVisibility =
  | "PRIVATE"
  | "PARTICIPANTS"
  | "DEAL_OWNER"
  | "SPECIFIC_PARTICIPANTS";

export interface PublicDocument {
  id: string;
  dealId: string;
  organizationId: string;
  createdByUserId: string;
  documentType: string;
  title: string;
  description: string | null;
  visibility: DocumentVisibility;
  visibleToOrganizationIds: string[];
  status: DocumentStatus;
  chainId: string;
  version: number;
  supersedesId: string | null;
  hasContent: boolean;
  originalFilename: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  sha256: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  expiresAt: string | null;
  reviewerUserId: string | null;
  reviewComment: string | null;
  createdAt: string;
  updatedAt: string;
}

export type RequirementStatus =
  | "OPEN"
  | "SUBMITTED"
  | "SATISFIED"
  | "REJECTED"
  | "WAIVED"
  | "EXPIRED";

export type RequirementType = "DOCUMENT" | "INFORMATION" | "CONFIRMATION";

export interface PublicRequirement {
  id: string;
  dealId: string;
  organizationId: string;
  createdByUserId: string;
  requirementType: RequirementType;
  title: string;
  description: string | null;
  status: RequirementStatus;
  required: boolean;
  dueAt: string | null;
  assignedOrganizationId: string | null;
  satisfiedAt: string | null;
  satisfiedByUserId: string | null;
  rejectionReason: string | null;
  waivedAt: string | null;
  waivedByUserId: string | null;
  documentGroups: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ReadinessRequirement {
  id: string;
  title: string;
  requirementType: RequirementType;
  required: boolean;
  status: RequirementStatus;
  satisfied: boolean;
}

export interface PublicReadiness {
  dealId: string;
  required: number;
  satisfied: number;
  outstanding: number;
  blocked: boolean;
  requirements: ReadinessRequirement[];
}

export interface PublicCounterparty {
  id: string;
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  organizationId: string;
  counterpartyOrganizationId: string;
  organizationName: string | null;
  counterpartyOrganizationName: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export type ApprovalPolicyStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface ApprovalPolicy {
  id: string;
  name: string;
  description: string | null;
  status: ApprovalPolicyStatus;
  rules: ApprovalRule[];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalRule {
  id?: string;
  ruleType: string;
  config: Record<string, unknown>;
  priority: number;
}

export type ApprovalWorkflowStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXPIRED"
  | "CANCELLED";

export type ApprovalRequestStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "SKIPPED"
  | "EXPIRED"
  | "CANCELLED";

export interface ApprovalRequest {
  id: string;
  workflowId: string;
  dealId: string;
  organizationId: string;
  approverUserId: string;
  approverRole: string | null;
  sequence: number;
  required: boolean;
  status: ApprovalRequestStatus;
  reason: string | null;
  dueAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
  approver?: { id: string; email: string; name?: string | null };
  workflow?: { id: string; status: ApprovalWorkflowStatus };
}

export interface ApprovalDecision {
  id: string;
  requestId: string;
  workflowId: string;
  dealId: string;
  organizationId: string;
  actorUserId: string;
  decision: "APPROVED" | "REJECTED";
  reason: string | null;
  decidedAt: string;
  createdAt: string;
}

export interface ApprovalWorkflow {
  id: string;
  dealId: string;
  organizationId: string;
  policyId: string;
  status: ApprovalWorkflowStatus;
  policySnapshot: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  requests?: ApprovalRequest[];
  decisions?: ApprovalDecision[];
  policy?: { id: string; name: string } | null;
}

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

export type ReconciliationStatus =
  | "PENDING"
  | "MATCHED"
  | "MISMATCHED"
  | "FAILED"
  | "RESOLVED";

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

export type DealIntelligenceRunStatus = "PENDING" | "COMPLETED" | "FAILED";

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
  status: DealIntelligenceRunStatus;
  provider: string | null;
  modelVersion: string | null;
  analysisVersion: string | null;
  inputHash: string;
  result: Record<string, unknown> | null;
  confidenceSummary: ConfidenceSummary | null;
  errorCode: string | null;
  requestedByUserId: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type OptimizationRunStatus = "PENDING" | "COMPLETED" | "FAILED";
export type OptimizationOperation = "OPTIMIZE" | "COMPARE";

export interface OptimizationMetricsSummary {
  feasible: boolean;
  selectedRoutes: number;
  solverType: string;
  problemId: string;
  objectiveValue: string | null;
}

export interface PublicDealOptimizationRun {
  id: string;
  dealId: string;
  organizationId: string;
  status: OptimizationRunStatus;
  operation: OptimizationOperation;
  optimizationVersion: string | null;
  solver: string | null;
  problemId: string | null;
  inputHash: string;
  result: Record<string, unknown> | null;
  metrics: OptimizationMetricsSummary | null;
  errorCode: string | null;
  requestedByUserId: string;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PublicInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: "OWNER" | "COUNTERPARTY" | "OBSERVER";
  state: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED" | "DECLINED";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
}

export interface SecurityEvent {
  id: string;
  type: string;
  userId: string | null;
  organizationId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PageMeta {
  total: number;
  page: number;
  limit: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export interface Cancelable {
  signal?: AbortSignal;
}