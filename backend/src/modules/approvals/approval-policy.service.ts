import {
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { SecurityEventType, writeSecurityEvent } from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import type { ApprovalWorkflowStatus } from "./approval.types.js";
import { evaluatePolicy } from "./approval-policy.evaluator.js";
import { validateAllRules } from "./approval.schemas.js";

// ---------------------------------------------------------------------------
// Policy service (CRUD only)
// ---------------------------------------------------------------------------

export async function createApprovalPolicy(
  organizationId: string,
  body: {
    name: string;
    description?: string;
    rules: Array<{ ruleType: string; config: Record<string, unknown> }>;
  },
  actorUserId: string,
  meta: RequestMeta,
) {
  validateAllRules(body.rules);

  const policy = await prisma.approvalPolicy.create({
    data: {
      organizationId,
      name: body.name,
      description: body.description ?? null,
      status: "DRAFT",
      createdByUserId: actorUserId,
      rules: {
        create: body.rules.map((rule, index) => ({
          ruleType: rule.ruleType as never,
          priority: index,
          config: rule.config as never,
        })),
      },
    },
    include: { rules: true },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_POLICY_CREATED,
    userId: actorUserId,
    organizationId,
    metadata: { policyId: policy.id, name: policy.name },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { policy };
}

export async function listApprovalPolicies(
  organizationId: string,
  query: { page?: number; limit?: number; status?: string },
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.ApprovalPolicyWhereInput = { organizationId };
  if (query.status) where.status = query.status as any;

  const [policies, total] = await prisma.$transaction([
    prisma.approvalPolicy.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { rules: { orderBy: { priority: "asc" } } },
    }),
    prisma.approvalPolicy.count({ where }),
  ]);

  return { policies, total, page, limit };
}

export async function getApprovalPolicy(organizationId: string, policyId: string) {
  return prisma.approvalPolicy.findFirst({
    where: { id: policyId, organizationId },
    include: { rules: { orderBy: { priority: "asc" } } },
  });
}

export async function updateApprovalPolicy(
  organizationId: string,
  policyId: string,
  body: {
    name?: string;
    description?: string;
    rules?: Array<{ ruleType: string; config: Record<string, unknown> }>;
  },
  actorUserId: string,
  meta: RequestMeta,
) {
  const current = await prisma.approvalPolicy.findFirst({
    where: { id: policyId, organizationId },
  });
  if (!current) throw AppError.approvalPolicyNotFound();
  if (current.status !== "DRAFT") {
    throw AppError.approvalPolicyInactive("Only DRAFT policies can be edited.");
  }

  if (body.rules) {
    validateAllRules(body.rules);
  }

  const data: Prisma.ApprovalPolicyUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description ?? null;

  if (body.rules) {
    data.rules = {
      deleteMany: {},
      create: body.rules.map((rule, index) => ({
        ruleType: rule.ruleType as never,
        priority: index,
        config: rule.config as never,
      })),
    };
  }

  const policy = await prisma.approvalPolicy.update({
    where: { id: policyId },
    data,
    include: { rules: { orderBy: { priority: "asc" } } },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_POLICY_UPDATED,
    userId: actorUserId,
    organizationId,
    metadata: { policyId: policy.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { policy };
}

export async function activateApprovalPolicy(
  organizationId: string,
  policyId: string,
  actorUserId: string,
  meta: RequestMeta,
) {
  const current = await prisma.approvalPolicy.findFirst({
    where: { id: policyId, organizationId },
  });
  if (!current) throw AppError.approvalPolicyNotFound();
  if (current.status === "ACTIVE") {
    throw AppError.approvalPolicyConflict("Policy is already active.");
  }

  const pendingWorkflows = await prisma.approvalWorkflow.count({
    where: { policyId, status: { in: ["PENDING", "NOT_STARTED"] as any } },
  });
  if (pendingWorkflows > 0) {
    throw AppError.approvalPolicyConflict("Cannot activate a policy with active workflows.");
  }

  const policy = await prisma.approvalPolicy.update({
    where: { id: policyId },
    data: { status: "ACTIVE" },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_POLICY_ACTIVATED,
    userId: actorUserId,
    organizationId,
    metadata: { policyId: policy.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { policy };
}

export async function deactivateApprovalPolicy(
  organizationId: string,
  policyId: string,
  actorUserId: string,
  meta: RequestMeta,
) {
  const current = await prisma.approvalPolicy.findFirst({
    where: { id: policyId, organizationId },
  });
  if (!current) throw AppError.approvalPolicyNotFound();
  if (current.status !== "ACTIVE") {
    throw AppError.approvalPolicyInactive("Only ACTIVE policies can be deactivated.");
  }

  const activeWorkflows = await prisma.approvalWorkflow.count({
    where: { policyId, status: { in: ["PENDING", "NOT_STARTED"] as any } },
  });
  if (activeWorkflows > 0) {
    throw AppError.approvalPolicyConflict("Cannot deactivate a policy with active workflows.");
  }

  const policy = await prisma.approvalPolicy.update({
    where: { id: policyId },
    data: { status: "INACTIVE" },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_POLICY_DEACTIVATED,
    userId: actorUserId,
    organizationId,
    metadata: { policyId: policy.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { policy };
}

export async function archiveApprovalPolicy(
  organizationId: string,
  policyId: string,
  actorUserId: string,
  meta: RequestMeta,
) {
  const current = await prisma.approvalPolicy.findFirst({
    where: { id: policyId, organizationId },
  });
  if (!current) throw AppError.approvalPolicyNotFound();
  if (current.status === "ARCHIVED") {
    throw AppError.approvalPolicyConflict("Policy is already archived.");
  }

  const policy = await prisma.approvalPolicy.update({
    where: { id: policyId },
    data: { status: "ARCHIVED" },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_POLICY_ARCHIVED,
    userId: actorUserId,
    organizationId,
    metadata: { policyId: policy.id },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { policy };
}

// ---------------------------------------------------------------------------
// Workflow operations
// ---------------------------------------------------------------------------

export async function startApprovalWorkflow(
  organizationId: string,
  dealId: string,
  body: { policyId: string; requestId?: string; expiresInMinutes?: number },
  actorUserId: string,
  meta: RequestMeta,
) {
  const policy = await prisma.approvalPolicy.findFirst({
    where: { id: body.policyId, organizationId, status: "ACTIVE" },
    include: { rules: { orderBy: { priority: "asc" } } },
  });
  if (!policy) throw AppError.approvalPolicyNotFound();

  // A deal has at most one approval workflow (enforced by a unique constraint
  // on ApprovalWorkflow.dealId). Check for any existing workflow so a repeat
  // request returns a clean 409 instead of a raw unique-constraint error.
  const existing = await prisma.approvalWorkflow.findFirst({
    where: { dealId },
  });
  if (existing) {
    throw AppError.approvalWorkflowAlreadyActive(
      "An approval workflow already exists for this deal.",
    );
  }

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
  });
  if (!deal) throw AppError.dealNotFound();

  const assignments = await evaluatePolicy(
    {
      policyId: policy.id,
      policyName: policy.name,
      rules: policy.rules.map((r) => ({
        ruleType: r.ruleType,
        config: r.config as Record<string, unknown>,
        priority: r.priority,
      })),
    },
    organizationId,
    { type: deal.type, currency: deal.currency, notionalAmount: deal.notionalAmount.toString() },
    prisma,
  );

  const snapshot = {
    policyId: policy.id,
    policyName: policy.name,
    rules: policy.rules.map((r) => ({
      ruleType: r.ruleType,
      config: r.config as Record<string, unknown>,
      priority: r.priority,
    })),
  } as unknown as Prisma.InputJsonValue;

  const expiresAt = body.expiresInMinutes
    ? new Date(Date.now() + body.expiresInMinutes * 60_000)
    : null;

  const workflow = await prisma.approvalWorkflow.create({
    data: {
      dealId,
      organizationId,
      policyId: policy.id,
      status: "PENDING",
      policySnapshot: snapshot,
      startedAt: new Date(),
      expiresAt,
    },
  });

  if (assignments.length > 0) {
    await prisma.approvalRequest.createMany({
      data: assignments.map((a) => ({
        workflowId: workflow.id,
        dealId,
        organizationId,
        approverUserId: a.userId,
        approverRole: a.roleName,
        sequence: a.sequence,
        required: a.required,
        status: "PENDING",
      })),
    });
  }

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_WORKFLOW_STARTED,
    userId: actorUserId,
    organizationId,
    metadata: { workflowId: workflow.id, dealId, policyId: policy.id, assignments: assignments.length },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { workflow, assignments };
}

export async function cancelApprovalWorkflow(
  organizationId: string,
  workflowId: string,
  actorUserId: string,
  meta: RequestMeta,
) {
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { id: workflowId, organizationId },
  });
  if (!workflow) throw AppError.approvalWorkflowNotFound();
  if (workflow.status !== "PENDING") {
    throw AppError.approvalWorkflowInvalidState("Only PENDING workflows can be cancelled.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.approvalWorkflow.update({
      where: { id: workflowId },
      data: { status: "CANCELLED", completedAt: new Date() },
    });
    await tx.approvalRequest.updateMany({
      where: { workflowId, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await writeSecurityEvent(tx, {
      type: SecurityEventType.APPROVAL_WORKFLOW_CANCELLED,
      userId: actorUserId,
      organizationId,
      metadata: { workflowId, dealId: workflow.dealId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });

  return { workflow };
}

export async function expireApprovalWorkflows(now: Date = new Date()) {
  const expired = await prisma.approvalWorkflow.findMany({
    where: {
      status: "PENDING",
      expiresAt: { lt: now },
    },
    include: { requests: true },
  });

  for (const workflow of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.approvalWorkflow.update({
        where: { id: workflow.id },
        data: { status: "EXPIRED", completedAt: now },
      });
      await tx.approvalRequest.updateMany({
        where: { workflowId: workflow.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await writeSecurityEvent(tx, {
        type: SecurityEventType.APPROVAL_WORKFLOW_EXPIRED,
        userId: undefined,
        organizationId: workflow.organizationId,
        metadata: { workflowId: workflow.id, dealId: workflow.dealId },
        ipAddress: null,
        userAgent: null,
      });
    });
  }

  return expired.length;
}

export async function getApprovalWorkflow(organizationId: string, workflowId: string) {
  return prisma.approvalWorkflow.findFirst({
    where: { id: workflowId, organizationId },
    include: {
      requests: {
        include: { approver: { select: { id: true, email: true } } },
        orderBy: { sequence: "asc" },
      },
      decisions: { orderBy: { decidedAt: "asc" } },
      policy: { select: { id: true, name: true } },
    },
  });
}

export async function listApprovalWorkflows(
  organizationId: string,
  query: { page?: number; limit?: number; status?: string },
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.ApprovalWorkflowWhereInput = { organizationId };
  if (query.status) where.status = query.status as any;

  const [workflows, total] = await prisma.$transaction([
    prisma.approvalWorkflow.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.approvalWorkflow.count({ where }),
  ]);

  return { workflows, total, page, limit };
}

export async function getApprovalPolicyForDeal(
  organizationId: string,
  dealId: string,
) {
  return prisma.approvalWorkflow.findFirst({
    where: { dealId, organizationId, status: { in: ["PENDING", "NOT_STARTED"] as ApprovalWorkflowStatus[] } },
    include: { policy: { include: { rules: true } } },
  });
}

export async function getApprovalsForDeal(
  organizationId: string,
  dealId: string,
) {
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { dealId, organizationId },
    include: {
      policy: { select: { id: true, name: true } },
      requests: {
        include: { approver: { select: { id: true, email: true } } },
        orderBy: { sequence: "asc" },
      },
      decisions: { orderBy: { decidedAt: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return workflows;
}

// ---------------------------------------------------------------------------
// Readiness check
// ---------------------------------------------------------------------------

export async function checkDealReadiness(
  organizationId: string,
  dealId: string,
) {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
    include: { requirements: true, documents: true },
  });
  if (!deal) throw AppError.dealNotFound();

  const activeWorkflow = await prisma.approvalWorkflow.findFirst({
    where: { dealId, organizationId, status: { in: ["PENDING", "NOT_STARTED"] as ApprovalWorkflowStatus[] } },
    include: { policy: { include: { rules: true } } },
  });

  if (!activeWorkflow) {
    return {
      ready: true,
      gates: [],
      noPolicy: true,
      message: "No active approval policy for this deal.",
    };
  }

  const gates = await evaluateGates(activeWorkflow.policy.rules, deal);
  const allReady = gates.every((g) => g.ready);

  return {
    ready: allReady,
    gates,
    noPolicy: false,
    message: allReady
      ? "All readiness gates are satisfied."
      : "Some readiness gates are not satisfied.",
  };
}

async function evaluateGates(
  rules: Array<{ ruleType: string; config: unknown }>,
  deal: { id: string; requirements: Array<{ id: string; status: string }>; documents: Array<{ id: string; documentType: string; status: string }> },
) {
  const gates: Array<{
    gateType: string;
    configured: string[];
    satisfied: string[];
    missing: string[];
    ready: boolean;
  }> = [];
  const requirementIds = new Set(deal.requirements.map((r) => r.id));
  const documentTypes = new Set(deal.documents.map((d) => d.documentType));

  for (const rule of rules) {
    if (rule.ruleType === "REQUIRED_REQUIREMENTS") {
      const config = rule.config as { requirementIds: string[] };
      const missing = config.requirementIds.filter(
        (id) =>
          !requirementIds.has(id) ||
          !deal.requirements.find((r) => r.id === id && r.status === "SATISFIED"),
      );
      gates.push({
        gateType: "REQUIRED_REQUIREMENTS",
        configured: config.requirementIds,
        satisfied: config.requirementIds.filter((id) => !missing.includes(id)),
        missing,
        ready: missing.length === 0,
      });
    } else if (rule.ruleType === "REQUIRED_DOCUMENTS") {
      const config = rule.config as { documentTypes: string[] };
      const missing = config.documentTypes.filter(
        (t) =>
          !documentTypes.has(t) ||
          !deal.documents.find((d) => d.documentType === t && d.status === "SUBMITTED"),
      );
      gates.push({
        gateType: "REQUIRED_DOCUMENTS",
        configured: config.documentTypes,
        satisfied: config.documentTypes.filter((t) => !missing.includes(t)),
        missing,
        ready: missing.length === 0,
      });
    }
  }

  return gates;
}
