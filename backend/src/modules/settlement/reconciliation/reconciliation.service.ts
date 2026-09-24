import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";
import { AppError } from "../../../lib/errors/index.js";
import { SecurityEventType, writeSecurityEvent } from "../../auth/security-events.js";
import type { RequestMeta } from "../../organizations/organization.service.js";
import { toPublicReconciliation, type PublicReconciliation } from "../settlement.types.js";
import { getSettlementProvider } from "../settlement.provider.js";
import { transitionDeal } from "../../deals/deal.service.js";

export interface ReconciliationResult {
  reconciliation: PublicReconciliation;
  matched: boolean;
}

export async function performReconciliation(
  organizationId: string,
  settlementId: string,
  actorUserId: string | null,
  meta: RequestMeta,
): Promise<ReconciliationResult> {
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, organizationId },
    include: { deal: true, reconciliation: true },
  });
  if (!settlement) throw AppError.settlementNotFound();

  if (settlement.status !== "SETTLED") {
    throw AppError.reconciliationStateConflict(
      `Settlement must be SETTLED to reconcile (current: ${settlement.status}).`,
    );
  }

  if (settlement.reconciliation) {
    if (settlement.reconciliation.status === "MATCHED") {
      return { reconciliation: toPublicReconciliation(settlement.reconciliation), matched: true };
    }
    if (settlement.reconciliation.status === "RESOLVED") {
      throw AppError.reconciliationAlreadyResolved();
    }
  }

  // Use a default user ID if actorUserId is null (e.g., for automated reconciliation)
  const effectiveActorUserId = actorUserId ?? "system";

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const actualCurrency: string | null = null;
    let actualReference: string | null = null;
    let actualState: string | null = null;
    let providerStatus: { status: string } | null = null;

    if (settlement.providerReference) {
      try {
        providerStatus = await getSettlementProvider().getStatus(settlement.providerReference);
        actualReference = providerStatus.status;
        actualState = providerStatus.status;
      } catch {
        // Provider unavailable - will mark as FAILED
      }
    }

    const expectedCurrency = settlement.currency;
    const expectedReference = settlement.providerReference ?? null;
    const expectedState = "SETTLED";

    let reconciliationStatus: "MATCHED" | "MISMATCHED" | "FAILED" = "MATCHED";
    const mismatchReasons: string[] = [];

    if (!providerStatus) {
      reconciliationStatus = "FAILED";
      mismatchReasons.push("Provider status unavailable");
    } else {
      if (providerStatus.status !== "SETTLED") {
        reconciliationStatus = "MISMATCHED";
        mismatchReasons.push(`Provider state is ${providerStatus.status}, expected SETTLED`);
      }
    }

    if (!settlement.providerReference && reconciliationStatus !== "FAILED") {
      reconciliationStatus = "MISMATCHED";
      mismatchReasons.push("No provider reference recorded");
    }

    const reconciliation = await tx.reconciliation.upsert({
      where: { settlementId },
      create: {
        organizationId,
        dealId: settlement.dealId,
        settlementId,
        expectedAmount: settlement.amount,
        actualAmount: null,
        expectedCurrency,
        actualCurrency,
        expectedReference,
        actualReference,
        expectedState,
        actualState,
        status: reconciliationStatus as "MATCHED" | "MISMATCHED" | "FAILED",
        mismatchReason: mismatchReasons.length > 0 ? mismatchReasons.join("; ") : null,
        checkedAt: new Date(),
      },
      update: {
        actualAmount: null,
        actualCurrency,
        actualReference,
        actualState,
        status: reconciliationStatus as "MATCHED" | "MISMATCHED" | "FAILED",
        mismatchReason: mismatchReasons.length > 0 ? mismatchReasons.join("; ") : null,
        checkedAt: new Date(),
      },
    });

    if (reconciliationStatus === "MATCHED") {
      await writeSecurityEvent(tx, {
        type: SecurityEventType.RECONCILIATION_MATCHED,
        userId: actorUserId ?? undefined,
        organizationId,
        metadata: {
          reconciliationId: reconciliation.id,
          settlementId,
          dealId: settlement.dealId,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    } else if (reconciliationStatus === "MISMATCHED") {
      await writeSecurityEvent(tx, {
        type: SecurityEventType.RECONCILIATION_MISMATCHED,
        userId: effectiveActorUserId,
        organizationId,
        metadata: {
          reconciliationId: reconciliation.id,
          settlementId,
          dealId: settlement.dealId,
          mismatchReason: mismatchReasons.join("; "),
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      // Transition deal to RECONCILING for manual resolution
      await transitionDeal(
        organizationId,
        settlement.dealId,
        { toStatus: "RECONCILING", requestId: `reconcile:${settlementId}`, version: settlement.deal.version },
        effectiveActorUserId,
        meta,
      );
    } else {
      await writeSecurityEvent(tx, {
        type: SecurityEventType.RECONCILIATION_FAILED,
        userId: effectiveActorUserId,
        organizationId,
        metadata: {
          reconciliationId: reconciliation.id,
          settlementId,
          dealId: settlement.dealId,
          reason: mismatchReasons.join("; "),
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      // Transition deal to RECONCILING for manual resolution
      await transitionDeal(
        organizationId,
        settlement.dealId,
        { toStatus: "RECONCILING", requestId: `reconcile:${settlementId}`, version: settlement.deal.version },
        effectiveActorUserId,
        meta,
      );
    }

    return {
      reconciliation: toPublicReconciliation(reconciliation),
      matched: reconciliationStatus === "MATCHED",
    };
  });
}

export async function resolveReconciliation(
  organizationId: string,
  reconciliationId: string,
  body: { requestId: string; resolutionReason: string },
  actorUserId: string,
  meta: RequestMeta,
): Promise<PublicReconciliation> {
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId },
    include: { settlement: { include: { deal: true } } },
  });
  if (!reconciliation) throw AppError.reconciliationNotFound();

  if (reconciliation.status === "RESOLVED") {
    throw AppError.reconciliationAlreadyResolved();
  }

  if (reconciliation.status === "MATCHED") {
    throw AppError.reconciliationStateConflict("Already matched reconciliation cannot be resolved.");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const updated = await tx.reconciliation.update({
      where: { id: reconciliationId },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
        resolutionReason: body.resolutionReason,
      },
    });

    await writeSecurityEvent(tx, {
      type: SecurityEventType.RECONCILIATION_RESOLVED,
      userId: actorUserId,
      organizationId,
      metadata: {
        reconciliationId,
        settlementId: reconciliation.settlementId,
        dealId: reconciliation.dealId,
        previousStatus: reconciliation.status,
        resolutionReason: body.resolutionReason,
      },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    if (reconciliation.settlement) {
      const deal = await tx.deal.findUnique({ where: { id: reconciliation.dealId } });
      if (deal && deal.status === "RECONCILING") {
        await transitionDeal(
          organizationId,
          reconciliation.dealId,
          { toStatus: "COMPLETED", requestId: body.requestId, version: deal.version },
          actorUserId,
          meta,
        );
      }
    }

    return toPublicReconciliation(updated);
  });
}

export async function getReconciliation(
  organizationId: string,
  reconciliationId: string,
): Promise<PublicReconciliation> {
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { id: reconciliationId, organizationId },
  });
  if (!reconciliation) throw AppError.reconciliationNotFound();

  return toPublicReconciliation(reconciliation);
}

export async function getReconciliationBySettlement(
  organizationId: string,
  settlementId: string,
): Promise<PublicReconciliation | null> {
  const reconciliation = await prisma.reconciliation.findFirst({
    where: { settlementId, organizationId },
  });
  if (!reconciliation) return null;

  return toPublicReconciliation(reconciliation);
}

export async function listReconciliations(
  organizationId: string,
  query: { page?: number; limit?: number; status?: string; dealId?: string },
) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const where: Prisma.ReconciliationWhereInput = { organizationId };
  if (query.status) where.status = query.status as any;
  if (query.dealId) where.dealId = query.dealId;

  const [reconciliations, total] = await prisma.$transaction([
    prisma.reconciliation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.reconciliation.count({ where }),
  ]);

  return {
    reconciliations: reconciliations.map(toPublicReconciliation),
    total,
    page,
    limit,
  };
}