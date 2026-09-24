import { z } from "zod";
import { AppError } from "../../lib/errors/index.js";
import { ISO_4217_CODES } from "../deals/deal.schemas.js";
import type {
  ApprovalRuleType,
  CurrencyConfig,
  DealTypeConfig,
  MultiApproverConfig,
  NotionalThresholdConfig,
  ParallelApprovalConfig,
  RequiredDocumentsConfig,
  RequiredRequirementsConfig,
  RoleApprovalConfig,
  SequentialApprovalConfig,
} from "./approval.types.js";

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export const dealUuidParamsSchema = z.object({
  organizationId: z.string().uuid(),
  dealId: z.string().uuid(),
});

export const approvalUuidParamsSchema = z.object({
  organizationId: z.string().uuid(),
  approvalId: z.string().uuid(),
});

export const policyUuidParamsSchema = z.object({
  organizationId: z.string().uuid(),
  policyId: z.string().uuid(),
});

export const workflowUuidParamsSchema = z.object({
  organizationId: z.string().uuid(),
  workflowId: z.string().uuid(),
});

export const requestUuidParamsSchema = z.object({
  organizationId: z.string().uuid(),
  requestId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Policy CRUD
// ---------------------------------------------------------------------------

export const createPolicyBodySchema = z.object({
  name: z.string().min(1, "Name is required.").max(200),
  description: z.string().max(2000).optional(),
  rules: z
    .array(z.record(z.unknown()))
    .min(1, "At least one rule is required."),
});

export const updatePolicyBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  rules: z.array(z.record(z.unknown())).optional(),
});

// ---------------------------------------------------------------------------
// Workflow start
// ---------------------------------------------------------------------------

export const startWorkflowBodySchema = z.object({
  policyId: z.string().uuid(),
  requestId: z.string().uuid().optional(),
  expiresInMinutes: z.number().int().positive().max(10080).optional(),
});

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export const decideRequestBodySchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  reason: z.string().max(2000).optional(),
});

export const escalateRequestBodySchema = z.object({
  reason: z.string().max(2000).optional(),
});

export const assignRequestBodySchema = z.object({
  approverUserId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Readiness query
// ---------------------------------------------------------------------------

export const readinessQuerySchema = z.object({});

// ---------------------------------------------------------------------------
// List queries
// ---------------------------------------------------------------------------

export const policyListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});

export const workflowListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(["NOT_STARTED", "PENDING", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"])
    .optional(),
});

export const requestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum(["PENDING", "APPROVED", "REJECTED", "SKIPPED", "EXPIRED", "CANCELLED"])
    .optional(),
});

// ---------------------------------------------------------------------------
// Rule config validation (for policy creation/update)
// ---------------------------------------------------------------------------

export function validateRuleConfig(
  ruleType: ApprovalRuleType,
  config: Record<string, unknown>,
): void {
  switch (ruleType) {
    case "NOTIONAL_THRESHOLD": {
      const c = config as NotionalThresholdConfig;
      if (!c.threshold || typeof c.threshold !== "string") {
        throw AppError.validation("NOTIONAL_THRESHOLD requires threshold (string).");
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        throw AppError.validation("NOTIONAL_THRESHOLD requires roles (non-empty array).");
      }
      if (
        c.comparator !== undefined &&
        ![">=", "=", "<="].includes(c.comparator as string)
      ) {
        throw AppError.validation("NOTIONAL_THRESHOLD comparator must be >=, =, or <=.");
      }
      break;
    }
    case "DEAL_TYPE": {
      const c = config as DealTypeConfig;
      if (!c.types || !Array.isArray(c.types) || c.types.length === 0) {
        throw AppError.validation("DEAL_TYPE requires types (non-empty array).");
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        throw AppError.validation("DEAL_TYPE requires roles (non-empty array).");
      }
      break;
    }
    case "CURRENCY": {
      const c = config as CurrencyConfig;
      if (!c.currencies || !Array.isArray(c.currencies) || c.currencies.length === 0) {
        throw AppError.validation("CURRENCY requires currencies (non-empty array).");
      }
      for (const cur of c.currencies as string[]) {
        if (!ISO_4217_CODES.has(cur)) {
          throw AppError.validation(`CURRENCY has unsupported code: ${cur}`);
        }
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        throw AppError.validation("CURRENCY requires roles (non-empty array).");
      }
      break;
    }
    case "ROLE_APPROVAL": {
      const c = config as RoleApprovalConfig;
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        throw AppError.validation("ROLE_APPROVAL requires roles (non-empty array).");
      }
      break;
    }
    case "MULTI_APPROVER": {
      const c = config as MultiApproverConfig;
      if (!Number.isInteger(c.threshold) || c.threshold < 1) {
        throw AppError.validation("MULTI_APPROVER requires threshold >= 1.");
      }
      if (!Number.isInteger(c.of) || c.of < c.threshold) {
        throw AppError.validation("MULTI_APPROVER requires of >= threshold.");
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        throw AppError.validation("MULTI_APPROVER requires roles (non-empty array).");
      }
      break;
    }
    case "SEQUENTIAL_APPROVAL": {
      const c = config as SequentialApprovalConfig;
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length < 2) {
        throw AppError.validation(
          "SEQUENTIAL_APPROVAL requires at least 2 roles.",
        );
      }
      break;
    }
    case "PARALLEL_APPROVAL": {
      const c = config as ParallelApprovalConfig;
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length < 1) {
        throw AppError.validation(
          "PARALLEL_APPROVAL requires at least 1 role.",
        );
      }
      break;
    }
    case "REQUIRED_DOCUMENTS": {
      const c = config as RequiredDocumentsConfig;
      if (!c.documentTypes || !Array.isArray(c.documentTypes) || c.documentTypes.length === 0) {
        throw AppError.validation(
          "REQUIRED_DOCUMENTS requires documentTypes (non-empty array).",
        );
      }
      break;
    }
    case "REQUIRED_REQUIREMENTS": {
      const c = config as RequiredRequirementsConfig;
      if (!c.requirementIds || !Array.isArray(c.requirementIds) || c.requirementIds.length === 0) {
        throw AppError.validation(
          "REQUIRED_REQUIREMENTS requires requirementIds (non-empty array).",
        );
      }
      break;
    }
    default:
      throw AppError.validation(`Unknown rule type: ${ruleType}`);
  }
}

export function validateAllRules(rules: Array<{ ruleType: string; config: unknown }>): void {
  for (const [index, rule] of rules.entries()) {
    if (!rule.ruleType || typeof rule.ruleType !== "string") {
      throw AppError.validation(`Rule at index ${index} is missing ruleType.`);
    }
    if (!rule.config || typeof rule.config !== "object") {
      throw AppError.validation(`Rule at index ${index} is missing config.`);
    }
    validateRuleConfig(rule.ruleType as ApprovalRuleType, rule.config as Record<string, unknown>);
  }
}
