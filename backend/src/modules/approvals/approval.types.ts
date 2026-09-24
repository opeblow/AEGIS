export type ApprovalPolicyStatus = "DRAFT" | "ACTIVE" | "INACTIVE" | "ARCHIVED";
export type ApprovalWorkflowStatus = "NOT_STARTED" | "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "CANCELLED";
export type ApprovalRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "SKIPPED" | "EXPIRED" | "CANCELLED";
export type ApprovalDecisionType = "APPROVED" | "REJECTED";
export type ApprovalRuleType =
  | "NOTIONAL_THRESHOLD"
  | "DEAL_TYPE"
  | "CURRENCY"
  | "REQUIRED_DOCUMENTS"
  | "REQUIRED_REQUIREMENTS"
  | "ROLE_APPROVAL"
  | "MULTI_APPROVER"
  | "SEQUENTIAL_APPROVAL"
  | "PARALLEL_APPROVAL";

// ---------------------------------------------------------------------------
// Policy snapshot (immutable, stored on ApprovalWorkflow)
// ---------------------------------------------------------------------------

export interface PolicySnapshot {
  policyId: string;
  policyName: string;
  rules: Array<{
    ruleType: ApprovalRuleType;
    config: Record<string, unknown>;
  }>;
}

// ---------------------------------------------------------------------------
// Evaluator output
// ---------------------------------------------------------------------------

export interface ApprovalAssignment {
  userId: string;
  roleName: string;
  sequence: number;
  required: boolean;
}

export interface ReadinessGate {
  gateType: "REQUIRED_DOCUMENTS" | "REQUIRED_REQUIREMENTS";
  configured: string[];
  satisfied: string[];
  missing: string[];
  ready: boolean;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type ApprovalDecisionAction = "APPROVE" | "REJECT";

export interface ApprovalDecisionRequest {
  action: ApprovalDecisionAction;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Workflow start
// ---------------------------------------------------------------------------

export interface StartWorkflowBody {
  policyId: string;
  requestId?: string;
  expiresInMinutes?: number;
}

// ---------------------------------------------------------------------------
// Types for the policy rule configuration (validated by schemas)
// ---------------------------------------------------------------------------

export type NotionalThresholdConfig = {
  threshold: string;
  comparator?: ">=" | "=" | "<=";
  roles: string[];
};

export type DealTypeConfig = {
  types: string[];
  roles: string[];
};

export type CurrencyConfig = {
  currencies: string[];
  roles: string[];
};

export type RoleApprovalConfig = {
  roles: string[];
};

export type MultiApproverConfig = {
  threshold: number;
  of: number;
  roles: string[];
};

export type SequentialApprovalConfig = {
  roles: string[];
};

export type ParallelApprovalConfig = {
  roles: string[];
};

export type RequiredDocumentsConfig = {
  documentTypes: string[];
};

export type RequiredRequirementsConfig = {
  requirementIds: string[];
};
