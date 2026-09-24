import {
  type ApprovalRequestStatus,
  type ApprovalWorkflowStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { SecurityEventType, writeSecurityEvent } from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import type { ApprovalDecisionAction } from "./approval.types.js";
import { decideRequestBodySchema } from "./approval.schemas.js";

// ---------------------------------------------------------------------------
// Request queries
// ---------------------------------------------------------------------------

export async function listApprovalRequests(
  organizationId: string,
  query: { page?: number; limit?: number; status?: string },
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.ApprovalRequestWhereInput = { organizationId };
  if (query.status) where.status = query.status as ApprovalRequestStatus;

  const [requests, total] = await prisma.$transaction([
    prisma.approvalRequest.findMany({
      where,
      orderBy: [{ sequence: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        workflow: { select: { id: true, status: true } },
        approver: { select: { id: true, email: true } },
      },
    }),
    prisma.approvalRequest.count({ where }),
  ]);

  return { requests, total, page, limit };
}

export async function getApprovalRequest(
  organizationId: string,
  requestId: string,
) {
  return prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
    include: {
      workflow: { select: { id: true, status: true } },
      approver: { select: { id: true, email: true } },
      decisions: { orderBy: { decidedAt: "asc" } },
    },
  });
}

// ---------------------------------------------------------------------------
// Decision / assign / escalate
// ---------------------------------------------------------------------------

export async function decideApprovalRequest(
  organizationId: string,
  requestId: string,
  actorUserId: string,
  body: { action: ApprovalDecisionAction; reason?: string },
  meta: RequestMeta,
) {
  const validated = decideRequestBodySchema.safeParse(body);
  if (!validated.success) {
    throw AppError.validation("Invalid decision body.", validated.error.issues);
  }

  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
  });
  if (!request) throw AppError.approvalRequestNotFound();
  if (request.status !== "PENDING") {
    throw AppError.approvalRequestInvalidState(
      `Request is ${request.status}, cannot decide.`,
    );
  } if (request.approverUserId !== actorUserId) {
    throw AppError.approvalRequestNotAssigned();
  }

  // Check sequential ordering: all previous requests in the workflow must be approved.
  const workflow = await prisma.approvalWorkflow.findFirst({
    where: { id: request.workflowId, organizationId },
    include: { requests: { orderBy: { sequence: "asc" } } },
  });
  if (!workflow) throw AppError.approvalWorkflowNotFound();

  const decisions = await prisma.approvalDecision.findMany({
    where: { requestId: { in: workflow.requests.map((r) => r.id) } },
    select: { requestId: true, decision: true },
  });
  const decisionMap = new Map(decisions.map((d) => [d.requestId, d.decision]));

  for (const req of workflow.requests) {
    if (req.id === requestId) break;
    if (req.required && decisionMap.get(req.id) !== "APPROVED") {
      throw AppError.approvalSequenceBlocked(
        "Previous required approvals must be approved first.",
      );
    }
  }

  const newStatus: "APPROVED" | "REJECTED" =
    body.action === "APPROVE" ? "APPROVED" : "REJECTED";

  const result = await prisma.$transaction(async (tx) => {
    // Optimistic concurrency check via version-like mechanism.
    // Since we don't have a version column on ApprovalRequest, we re-read
    // to confirm still PENDING (single-round check).
    const stillPending = await tx.approvalRequest.findFirst({
      where: { id: requestId, organizationId, status: "PENDING" },
    });
    if (!stillPending) {
      const current = await tx.approvalRequest.findFirst({
        where: { id: requestId, organizationId },
      });
      if (!current) throw AppError.approvalRequestNotFound();
      throw AppError.approvalConcurrencyConflict();
    }

    const decision = await tx.approvalDecision.create({
      data: {
        requestId,
        workflowId: request.workflowId,
        dealId: request.dealId,
        organizationId,
        actorUserId,
        decision: newStatus,
        reason: body.reason ?? null,
      },
    });

    await tx.approvalRequest.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        respondedAt: new Date(),
      },
    });

    const updatedRequest = await tx.approvalRequest.findFirst({
      where: { id: requestId },
      include: { decisions: { orderBy: { decidedAt: "asc" } } },
    });

    // Reflect this decision in the tally before evaluating completion. The
    // decisionMap was read before the transaction, so it does not yet contain
    // the decision we just persisted.
    decisionMap.set(requestId, newStatus);

    const reqCount = workflow.requests.length;
    const approvedCount = workflow.requests.filter(
      (r) => decisionMap.get(r.id) === "APPROVED",
    ).length;
    const rejectedCount = workflow.requests.filter(
      (r) => decisionMap.get(r.id) === "REJECTED",
    ).length;
    const decidedCount = approvedCount + rejectedCount;

    let workflowStatus = workflow.status as ApprovalWorkflowStatus;
    if (body.action === "REJECT") {
      workflowStatus = "REJECTED";
    } else if (decidedCount >= reqCount && rejectedCount === 0) {
      workflowStatus = "APPROVED";
    } else if (decidedCount >= reqCount && rejectedCount > 0) {
      workflowStatus = "REJECTED";
    }

    if (workflowStatus !== workflow.status) {
      await tx.approvalWorkflow.update({
        where: { id: request.workflowId },
        data: { status: workflowStatus, completedAt: new Date() },
      });
    }

    await writeSecurityEvent(tx, {
      type: body.action === "APPROVE"
        ? SecurityEventType.APPROVAL_REQUEST_APPROVED
        : SecurityEventType.APPROVAL_REQUEST_REJECTED,
      userId: actorUserId,
      organizationId,
      metadata: {
        requestId,
        workflowId: request.workflowId,
        decision: body.action,
        workflowStatus,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      decision,
      request: updatedRequest,
      workflowStatus,
    };
  });

  return result;
}

export async function assignApprovalRequest(
  organizationId: string,
  requestId: string,
  body: { approverUserId: string },
  actorUserId: string,
  meta: RequestMeta,
) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
  });
  if (!request) throw AppError.approvalRequestNotFound();
  if (request.status !== "PENDING") {
    throw AppError.approvalRequestInvalidState(
      `Request is ${request.status}, cannot reassign.`,
    );
  }

  if (body.approverUserId !== request.approverUserId) {
    const conflicting = await prisma.approvalRequest.findFirst({
      where: {
        workflowId: request.workflowId,
        approverUserId: body.approverUserId,
        id: { not: requestId },
      },
      select: { id: true },
    });
    if (conflicting) throw AppError.approvalApproverAlreadyAssigned();
  }

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { approverUserId: body.approverUserId },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_REQUEST_ASSIGNED,
    userId: actorUserId,
    organizationId,
    metadata: { requestId, newApprover: body.approverUserId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { request: await getApprovalRequest(organizationId, requestId) };
}

export async function escalateApprovalRequest(
  organizationId: string,
  requestId: string,
  body: { reason?: string },
  actorUserId: string,
  meta: RequestMeta,
) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
  });
  if (!request) throw AppError.approvalRequestNotFound();
  if (request.status !== "PENDING") {
    throw AppError.approvalRequestInvalidState(
      `Request is ${request.status}, cannot escalate.`,
    );
  }

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: "PENDING" }, // stays pending, escalation is metadata
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_REQUEST_ESCALATED,
    userId: actorUserId,
    organizationId,
    metadata: { requestId, reason: body.reason },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { request: await getApprovalRequest(organizationId, requestId) };
}

export async function cancelApprovalRequest(
  organizationId: string,
  requestId: string,
  actorUserId: string,
  meta: RequestMeta,
) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: requestId, organizationId },
  });
  if (!request) throw AppError.approvalRequestNotFound();
  if (request.status !== "PENDING") {
    throw AppError.approvalRequestInvalidState(
      `Request is ${request.status}, cannot cancel.`,
    );
  }

  await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED" },
  });

  await writeSecurityEvent(prisma, {
    type: SecurityEventType.APPROVAL_REQUEST_CANCELLED,
    userId: actorUserId,
    organizationId,
    metadata: { requestId },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { request: await getApprovalRequest(organizationId, requestId) };
}
