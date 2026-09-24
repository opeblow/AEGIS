import { createHash } from "node:crypto";
import { Prisma, type Deal, type SettlementTransition } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { SecurityEventType, writeSecurityEvent } from "../auth/security-events.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import {
  settlementTransitionReasonOf,
  settlementTransitionTypeFor,
  type SettlementStatus,
} from "./settlement.state.js";
import { validateInitiateSettlementBody } from "./settlement.schemas.js";
import {
  toPublicSettlement,
  toPublicSettlementTransition,
  type PublicSettlement,
  type PublicSettlementTransition,
} from "./settlement.types.js";
import { getSettlementProvider } from "./settlement.provider.js";
import { checkDealReadiness } from "../approvals/approval-policy.service.js";
import { transitionDeal } from "../deals/deal.service.js";

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export interface SettlementActionResult {
  settlement: PublicSettlement;
  transition: PublicSettlementTransition;
  replay: boolean;
}

async function assertDealReadyForSettlement(
  deal: Deal,
  organizationId: string,
): Promise<void> {
  if (deal.status !== "APPROVED") {
    throw AppError.settlementNotReady(
      `Deal must be APPROVED to initiate settlement (current: ${deal.status}).`,
    );
  }

  const activeSettlement = await prisma.settlement.findFirst({
    where: { dealId: deal.id },
  });
  if (activeSettlement) {
    if (activeSettlement.status === "SETTLED") {
      throw AppError.settlementAlreadyCompleted();
    }
    if (!["FAILED", "CANCELLED", "EXPIRED"].includes(activeSettlement.status)) {
      throw AppError.settlementAlreadyActive();
    }
  }

  const readiness = await checkDealReadiness(organizationId, deal.id);
  if (!readiness.ready) {
    const missing = readiness.gates
      .filter((g) => !g.ready)
      .flatMap((g) => g.missing)
      .join(", ");
    throw AppError.settlementNotReady(
      `Deal readiness not satisfied. Missing: ${missing || "unknown"}`,
    );
  }
}

export async function initiateSettlement(
  organizationId: string,
  dealId: string,
  body: unknown,
  actorUserId: string,
  meta: RequestMeta,
): Promise<SettlementActionResult> {
  const validated = validateInitiateSettlementBody(body);
  const { idempotencyKey, requestId } = validated;

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, organizationId },
  });
  if (!deal) throw AppError.dealNotFound();

  const keyHash = sha256(idempotencyKey);
  const payloadHash = sha256(JSON.stringify({ idempotencyKey, requestId }));

  // Check idempotency first - if there's an existing settlement with matching payload, return replay
  const existing = await prisma.settlement.findFirst({
    where: { organizationId, dealId },
  });
  if (existing) {
    if (existing.idempotencyPayloadHash && existing.idempotencyPayloadHash !== payloadHash) {
      throw AppError.settlementIdempotencyConflict();
    }
    // Return replay without checking deal readiness (idempotent replay)
    return {
      settlement: toPublicSettlement(existing),
      transition: toPublicSettlementTransition(
        await prisma.settlementTransition.findFirst({
          where: { settlementId: existing.id, toStatus: existing.status as SettlementStatus },
          orderBy: { createdAt: "desc" },
        }) as SettlementTransition,
      ),
      replay: true,
    };
  }

  // Only check deal readiness for new settlements
  await assertDealReadyForSettlement(deal, organizationId);

  return prisma.$transaction(async (tx) => {
    const existingInTx = await tx.settlement.findFirst({
      where: { organizationId, dealId },
    });
    if (existingInTx) {
      if (existingInTx.idempotencyPayloadHash && existingInTx.idempotencyPayloadHash !== payloadHash) {
        throw AppError.settlementIdempotencyConflict();
      }
      return {
        settlement: toPublicSettlement(existingInTx),
        transition: toPublicSettlementTransition(
          await tx.settlementTransition.findFirst({
            where: { settlementId: existingInTx.id, toStatus: existingInTx.status as SettlementStatus },
            orderBy: { createdAt: "desc" },
          }) as SettlementTransition,
        ),
        replay: true,
      };
    }

    const settlement = await tx.settlement.create({
      data: {
        organizationId,
        dealId,
        provider: "MOCK",
        status: "CREATED",
        amount: deal.notionalAmount,
        currency: deal.currency,
        assetIdentifier: null,
        initiatedByUserId: actorUserId,
        idempotencyKeyHash: keyHash,
        idempotencyPayloadHash: payloadHash,
      },
    });

    const transition = await tx.settlementTransition.create({
      data: {
        settlementId: settlement.id,
        dealId,
        organizationId,
        requestId: requestId ?? null,
        transitionType: "SETTLEMENT_CREATED",
        fromStatus: "CREATED",
        toStatus: "CREATED",
        reason: "Settlement created.",
        actorUserId,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.SETTLEMENT_CREATED,
      userId: actorUserId,
      organizationId,
      metadata: { settlementId: settlement.id, dealId, requestId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await transitionDeal(
      organizationId,
      dealId,
      { toStatus: "SETTLEMENT_PENDING", requestId: requestId ?? `settle:${settlement.id}`, version: deal.version },
      actorUserId,
      meta,
    );

    return {
      settlement: toPublicSettlement(settlement),
      transition: toPublicSettlementTransition(transition),
      replay: false,
    };
  });
}

export async function submitSettlement(
  organizationId: string,
  settlementId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<SettlementActionResult> {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, organizationId },
    include: { deal: true },
  });
  if (!settlement) throw AppError.settlementNotFound();

  if (settlement.status !== "CREATED") {
    throw AppError.settlementStateConflict(
      `Settlement must be in CREATED status to submit (current: ${settlement.status}).`,
    );
  }

  const requestId = `submit:${settlementId}:${Date.now()}`;

  return prisma.$transaction(async (tx) => {
    await tx.settlementTransition.create({
      data: {
        settlementId,
        dealId: settlement.dealId,
        organizationId,
        requestId,
        transitionType: "SETTLEMENT_SUBMITTING",
        fromStatus: "CREATED",
        toStatus: "SUBMITTING",
        reason: "Submitting settlement to provider.",
        actorUserId,
      },
    });

    await tx.settlement.update({
      where: { id: settlementId },
      data: { status: "SUBMITTING" },
    });

    try {
      const submissionPayload = {
        dealId: settlement.dealId,
        organizationId,
        amount: settlement.amount.toString(),
        currency: settlement.currency,
        assetIdentifier: settlement.assetIdentifier ?? undefined,
        metadata: settlement.metadata as Record<string, unknown> | undefined,
      };

      const providerResult = await getSettlementProvider().submit(settlementId, submissionPayload);

      const submittedTransition = await tx.settlementTransition.create({
        data: {
          settlementId,
          dealId: settlement.dealId,
          organizationId,
          requestId,
          transitionType: "SETTLEMENT_SUBMITTED",
          fromStatus: "SUBMITTING",
          toStatus: "SUBMITTED",
          reason: "Provider acknowledged submission.",
          actorUserId,
          metadata: { providerReference: providerResult.providerReference },
        },
      });

      const updatedSettlement = await tx.settlement.update({
        where: { id: settlementId },
        data: {
          status: "SUBMITTED",
          providerReference: providerResult.providerReference,
          externalTransactionId: providerResult.externalTransactionId ?? null,
          submittedAt: providerResult.submittedAt,
        },
      });

      await writeSecurityEvent(tx, {
        type: SecurityEventType.SETTLEMENT_SUBMITTED,
        userId: actorUserId,
        organizationId,
        metadata: {
          settlementId,
          dealId: settlement.dealId,
          providerReference: providerResult.providerReference,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      return {
        settlement: toPublicSettlement(updatedSettlement),
        transition: toPublicSettlementTransition(submittedTransition),
        replay: false,
      };
    } catch (err) {
      await tx.settlementTransition.create({
        data: {
          settlementId,
          dealId: settlement.dealId,
          organizationId,
          requestId,
          transitionType: "SETTLEMENT_FAILED",
          fromStatus: "SUBMITTING",
          toStatus: "FAILED",
          reason: `Provider submission failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          actorUserId,
        },
      });

      await tx.settlement.update({
        where: { id: settlementId },
        data: { status: "FAILED", failureReason: err instanceof Error ? err.message : "Unknown error", failedAt: new Date() },
      });

      await writeSecurityEvent(tx, {
        type: SecurityEventType.SETTLEMENT_FAILED,
        userId: actorUserId,
        organizationId,
        metadata: {
          settlementId,
          dealId: settlement.dealId,
          reason: err instanceof Error ? err.message : "Unknown error",
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });

      // Return failed result instead of throwing - transaction will commit with FAILED status
      const failedSettlement = await tx.settlement.findUnique({ where: { id: settlementId } });
      const failedTransition = await tx.settlementTransition.findFirst({
        where: { settlementId, toStatus: "FAILED" },
        orderBy: { createdAt: "desc" },
      });
      return {
        settlement: toPublicSettlement(failedSettlement!),
        transition: toPublicSettlementTransition(failedTransition as SettlementTransition),
        replay: false,
      };
    }
  });
}

export async function getSettlementStatus(
  organizationId: string,
  settlementId: string,
  actorUserId: string,
): Promise<SettlementActionResult> {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, organizationId },
    include: { deal: true },
  });
  if (!settlement) throw AppError.settlementNotFound();

  if (settlement.providerReference) {
    try {
      const providerStatus = await getSettlementProvider().getStatus(settlement.providerReference);
      const newStatus = mapProviderStatusToSettlement(providerStatus.status);

      if (newStatus !== settlement.status) {
        return prisma.$transaction(async (tx) => {
          const transition = await tx.settlementTransition.create({
            data: {
              settlementId,
              dealId: settlement.dealId,
              organizationId,
              requestId: `poll:${settlementId}:${Date.now()}`,
              transitionType: settlementTransitionTypeFor(newStatus),
              fromStatus: settlement.status as SettlementStatus,
              toStatus: newStatus,
              reason: settlementTransitionReasonOf(settlementTransitionTypeFor(newStatus)),
              actorUserId: null,
            },
          });

          const data: Prisma.SettlementUpdateInput = { status: newStatus };
          if (newStatus === "SETTLED") {
            data.completedAt = new Date();
          } else if (newStatus === "FAILED") {
            data.failedAt = new Date();
            data.failureReason = "Provider reported failure";
          }

          const updatedSettlement = await tx.settlement.update({
            where: { id: settlementId },
            data,
          });

          if (newStatus === "SETTLED") {
            await writeSecurityEvent(tx, {
              type: SecurityEventType.SETTLEMENT_COMPLETED,
              userId: undefined,
              organizationId,
              metadata: { settlementId, dealId: settlement.dealId, providerReference: settlement.providerReference },
              ipAddress: null,
              userAgent: null,
            });

            await transitionDeal(
              organizationId,
              settlement.dealId,
              { toStatus: "SETTLED", requestId: `settle:complete:${settlementId}`, version: settlement.deal.version },
              actorUserId,
              { ipAddress: null, userAgent: null },
            );
          } else if (newStatus === "FAILED") {
            await writeSecurityEvent(tx, {
              type: SecurityEventType.SETTLEMENT_FAILED,
              userId: undefined,
              organizationId,
              metadata: { settlementId, dealId: settlement.dealId, reason: "Provider reported failure" },
              ipAddress: null,
              userAgent: null,
            });

            await transitionDeal(
              organizationId,
              settlement.dealId,
              { toStatus: "FAILED", requestId: `settle:fail:${settlementId}`, version: settlement.deal.version },
              actorUserId,
              { ipAddress: null, userAgent: null },
            );
          }

          return {
            settlement: toPublicSettlement(updatedSettlement),
            transition: toPublicSettlementTransition(transition),
            replay: false,
          };
        });
      }
    } catch {
      // Provider status check failed - return current state
    }
  }

  const latestTransition = await prisma.settlementTransition.findFirst({
    where: { settlementId },
    orderBy: { createdAt: "desc" },
  });

  return {
    settlement: toPublicSettlement(settlement),
    transition: latestTransition
      ? toPublicSettlementTransition(latestTransition)
      : {
          id: "",
          settlementId,
          dealId: settlement.dealId,
          organizationId,
          requestId: null,
          transitionType: "",
          fromStatus: settlement.status as SettlementStatus,
          toStatus: settlement.status as SettlementStatus,
          reason: "",
          actorUserId: null,
          metadata: null,
          createdAt: settlement.createdAt.toISOString(),
        },
    replay: false,
  };
}

function mapProviderStatusToSettlement(status: string): SettlementStatus {
  const mapping: Record<string, SettlementStatus> = {
    SUBMITTED: "SUBMITTED",
    PENDING: "PENDING",
    SETTLED: "SETTLED",
    FAILED: "FAILED",
    CANCELLED: "CANCELLED",
    EXPIRED: "EXPIRED",
  };
  return mapping[status] ?? "PENDING";
}

export async function cancelSettlement(
  organizationId: string,
  settlementId: string,
  actorUserId: string,
  meta: RequestMeta,
): Promise<SettlementActionResult> {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, organizationId },
    include: { deal: true },
  });
  if (!settlement) throw AppError.settlementNotFound();

  if (["SETTLED", "FAILED", "CANCELLED", "EXPIRED"].includes(settlement.status)) {
    throw AppError.settlementStateConflict(
      `Settlement is in terminal status ${settlement.status}, cannot cancel.`,
    );
  }

  const requestId = `cancel:${settlementId}:${Date.now()}`;

  return prisma.$transaction(async (tx) => {
    const provider = getSettlementProvider();
    if (settlement.providerReference && provider.cancel) {
      try {
        await provider.cancel(settlement.providerReference);
      } catch {
        // Log but continue with local cancellation
      }
    }

    const transition = await tx.settlementTransition.create({
      data: {
        settlementId,
        dealId: settlement.dealId,
        organizationId,
        requestId,
        transitionType: "SETTLEMENT_CANCELLED",
        fromStatus: settlement.status as SettlementStatus,
        toStatus: "CANCELLED",
        reason: "Settlement cancelled by user.",
        actorUserId,
      },
    });

    const updatedSettlement = await tx.settlement.update({
      where: { id: settlementId },
      data: { status: "CANCELLED" },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.SETTLEMENT_CANCELLED,
      userId: actorUserId,
      organizationId,
      metadata: { settlementId, dealId: settlement.dealId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    await transitionDeal(
      organizationId,
      settlement.dealId,
      { toStatus: "CANCELLED", requestId, version: settlement.deal.version },
      actorUserId,
      meta,
    );

    return {
      settlement: toPublicSettlement(updatedSettlement),
      transition: toPublicSettlementTransition(transition),
      replay: false,
    };
  });
}

export async function listSettlements(
  organizationId: string,
  query: { page?: number; limit?: number; status?: string; dealId?: string },
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.SettlementWhereInput = { organizationId };
  if (query.status) where.status = query.status as SettlementStatus;
  if (query.dealId) where.dealId = query.dealId;

  const [settlements, total] = await prisma.$transaction([
    prisma.settlement.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.settlement.count({ where }),
  ]);

  return {
    settlements: settlements.map(toPublicSettlement),
    total,
    page,
    limit,
  };
}

export async function getSettlementHistory(
  organizationId: string,
  settlementId: string,
  query: { limit?: number; offset?: number },
) {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, organizationId },
  });
  if (!settlement) throw AppError.settlementNotFound();

  const [transitions, total] = await prisma.$transaction([
    prisma.settlementTransition.findMany({
      where: { settlementId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      skip: query.offset ?? 0,
      take: query.limit ?? 50,
    }),
    prisma.settlementTransition.count({ where: { settlementId } }),
  ]);

  return {
    transitions: transitions.map(toPublicSettlementTransition),
    total,
    limit: query.limit ?? 50,
    offset: query.offset ?? 0,
  };
}