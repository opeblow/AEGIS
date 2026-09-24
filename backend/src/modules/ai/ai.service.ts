import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { stableStringify } from "../../lib/stable-stringify.js";
import type { DealViewer } from "../negotiation/participant-policy.js";
import type { RequestMeta } from "../organizations/organization.service.js";
import {
  recordSecurityEvent,
  SecurityEventType,
} from "../auth/security-events.js";
import { buildDealIntelligenceContext } from "./ai.mapper.js";
import {
  getAiClient,
  type AiClient,
} from "./ai.client.js";
import {
  dealIntelligenceQuerySchema,
  type DealIntelligenceContext,
  type QueryAnswer,
} from "./ai.schemas.js";
import {
  toPublicRun,
  type ConfidenceSummary,
  type PublicDealIntelligenceRun,
} from "./ai.types.js";

/**
 * Deal Intelligence (Phase 9) — orchestration.
 *
 * Idempotency model ("avoid unlimited duplicate runs"):
 *   - A COMPLETED run whose `inputHash` equals the current context's hash is
 *     REPLAYED (returned as-is) instead of calling the provider again.
 *   - A PENDING run for this deal is returned (still in flight).
 *   - Otherwise a PENDING run is created, the provider is called, and the run
 *     is marked COMPLETED (with the strict-validated result) or FAILED (with
 *     a stable AI_* errorCode). Failed runs retry on the next analyze.
 *
 * An identical-hash analyze under concurrency can create duplicate PENDING
 * rows (no DB uniqueness on inputHash); the replay rule bounds the cost to a
 * single redundant provider call, never unbounded duplicates. Runs are
 * append-only history and never mutate authoritative deal state.
 *
 * The canonical hash is computed over the exact validated context (sorted
 * keys), so identical authorized contexts always produce identical hashes.
 */

export const AI_CLIENT_VERSION = "1.0";
export const AI_ANALYSIS_VERSION = "1.0";

export interface AnalyzeOutcome {
  run: PublicDealIntelligenceRun;
  replayed: boolean;
}

export interface IntelligenceRunQuery {
  limit: number;
  offset: number;
  status?: "PENDING" | "COMPLETED" | "FAILED";
}

export async function analyzeDealIntelligence(
  viewer: DealViewer,
  dealId: string,
  actorUserId: string,
  meta: RequestMeta,
  deps: { client?: AiClient } = {},
): Promise<AnalyzeOutcome> {
  const client = deps.client ?? getAiClient();
  const context = await buildDealIntelligenceContext(viewer);
  const inputHash = canonicalContextHash(context);

  const completed = await prisma.dealIntelligenceRun.findFirst({
    where: { dealId, status: "COMPLETED", inputHash },
    orderBy: { createdAt: "desc" },
  });
  if (completed) {
    return { run: toPublicRun(completed), replayed: true };
  }

  const pending = await prisma.dealIntelligenceRun.findFirst({
    where: { dealId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
  });
  if (pending) {
    return { run: toPublicRun(pending), replayed: true };
  }

  const run = await prisma.dealIntelligenceRun.create({
    data: {
      organizationId: viewer.organizationId,
      dealId,
      requestedByUserId: actorUserId,
      status: "PENDING",
      inputHash,
      analysisVersion: AI_ANALYSIS_VERSION,
    },
  });

  await recordSecurityEvent({
    type: SecurityEventType.DEAL_INTELLIGENCE_REQUESTED,
    userId: actorUserId,
    organizationId: viewer.organizationId,
    metadata: { dealId, runId: run.id, inputHash },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  try {
    const { result } = await client.analyze(context);
    if (result.deal_id !== dealId) {
      throw AppError.aiInvalidResponse(
        "The intelligence service answered for a different deal.",
      );
    }
    const confidenceSummary: ConfidenceSummary = {
      confidence: result.confidence,
      riskFlags: result.risk_flags.length,
      blockers: result.blockers.length,
      documentFindings: result.document_findings.length,
      modelSummary: result.summary.model_summary,
    };

    const updated = await prisma.dealIntelligenceRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        provider: result.model.provider,
        modelVersion: result.model.version,
        result: result as unknown as Prisma.InputJsonValue,
        confidenceSummary: confidenceSummary as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    await recordSecurityEvent({
      type: SecurityEventType.DEAL_INTELLIGENCE_COMPLETED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { dealId, runId: run.id, inputHash },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { run: toPublicRun(updated), replayed: false };
  } catch (cause) {
    const errorCode =
      cause instanceof AppError ? cause.code : "AI_ANALYSIS_FAILED";
    const safeError =
      cause instanceof AppError
        ? cause
        : AppError.aiAnalysisFailed(undefined, cause);

    await prisma.dealIntelligenceRun
      .update({
        where: { id: run.id },
        data: {
          status: "FAILED",
          errorCode,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);

    await recordSecurityEvent({
      type: SecurityEventType.DEAL_INTELLIGENCE_FAILED,
      userId: actorUserId,
      organizationId: viewer.organizationId,
      metadata: { dealId, runId: run.id, errorCode },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    throw safeError;
  }
}

/**
 * Stateless Q&A against the same authorized context. Persists no run — the
 * answer is a one-shot advisory answer; `within_scope` comes from the model.
 */
export async function queryDealIntelligence(
  viewer: DealViewer,
  dealId: string,
  question: string,
  actorUserId: string,
  meta: RequestMeta,
  deps: { client?: AiClient } = {},
): Promise<{ answer: QueryAnswer }> {
  const client = deps.client ?? getAiClient();
  const context = await buildDealIntelligenceContext(viewer);
  const payload = dealIntelligenceQuerySchema.parse({
    ...context,
    question,
  });

  const { answer } = await client.query(payload);
  if (answer.deal_id !== dealId) {
    throw AppError.aiInvalidResponse(
      "The intelligence service answered for a different deal.",
    );
  }

  await recordSecurityEvent({
    type: SecurityEventType.DEAL_INTELLIGENCE_QUERIED,
    userId: actorUserId,
    organizationId: viewer.organizationId,
    metadata: { dealId, questionLength: question.length },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { answer };
}

export async function listDealIntelligenceRuns(
  viewer: DealViewer,
  dealId: string,
  query: IntelligenceRunQuery,
): Promise<{ runs: PublicDealIntelligenceRun[]; total: number; limit: number; offset: number }> {
  const where: Prisma.DealIntelligenceRunWhereInput = {
    dealId,
    organizationId: viewer.organizationId,
    ...(query.status ? { status: query.status } : {}),
  };
  const [runs, total] = await prisma.$transaction([
    prisma.dealIntelligenceRun.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
    }),
    prisma.dealIntelligenceRun.count({ where }),
  ]);
  return {
    runs: runs.map(toPublicRun),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getDealIntelligenceRun(
  viewer: DealViewer,
  dealId: string,
  runId: string,
): Promise<{ run: PublicDealIntelligenceRun }> {
  const run = await prisma.dealIntelligenceRun.findFirst({
    where: { id: runId, dealId, organizationId: viewer.organizationId },
  });
  if (!run) throw AppError.aiAnalysisNotFound();
  return { run: toPublicRun(run) };
}

/**
 * SHA-256 of the canonical, key-sorted serialization of the context. Sorted
 * keys make the hash independent of object insertion order; the parsed
 * context always carries the full key set (nulls, never absent keys), so
 * identical inputs always hash identically.
 */
export function canonicalContextHash(context: DealIntelligenceContext): string {
  return createHash("sha256")
    .update(stableStringify(context))
    .digest("hex");
}

export { stableStringify };