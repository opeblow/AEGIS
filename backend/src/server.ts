import { buildApp } from "./app.js";
import { getEnv, envDescription } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { cleanupExpiredSessions } from "./modules/auth/session.service.js";
import { cleanupExpiredVerifications } from "./modules/auth/verification.service.js";
import { cleanupExpiredPasswordResets } from "./modules/auth/password-reset.service.js";
import { expireEligibleDeals } from "./modules/deals/deal.service.js";
import { expireEligibleOffers } from "./modules/negotiation/offer.service.js";
import {
  expireEligibleDocuments,
  expireEligibleRequirements,
} from "./modules/documents/index.js";

async function runAuthCleanup(app: {
  log: { info: (o: object, m: string) => void };
}): Promise<void> {
  try {
    const [sessions, verifications, passwordResets] = await Promise.all([
      cleanupExpiredSessions(),
      cleanupExpiredVerifications(),
      cleanupExpiredPasswordResets(),
    ]);
    app.log.info(
      {
        sessions,
        verifications,
        passwordResets,
      },
      "auth cleanup completed",
    );
  } catch (err) {
    app.log.info({ err }, "auth cleanup failed");
  }
}

/**
 * Phase 4 deadline expiry. Deals whose expiresAt passed are moved through the
 * state machine (never a direct status write) behind an audited, idempotent
 * worker. Failures are logged and re-attempted on the next tick.
 */
async function runDealExpiry(app: {
  log: { info: (o: object, m: string) => void };
}): Promise<void> {
  try {
    const expired = await expireEligibleDeals();
    if (expired > 0) {
      app.log.info({ expired }, "deal expiry completed");
    }
  } catch (err) {
    app.log.info({ err }, "deal expiry failed");
  }
}

/**
 * Phase 5 offer deadline expiry. SUBMITTED/COUNTERED offers whose expiresAt
 * passed are moved to EXPIRED through the offer state machine (audited,
 * idempotent worker). Drafts are untouched — they are simply un-submittable.
 */
async function runOfferExpiry(app: {
  log: { info: (o: object, m: string) => void };
}): Promise<void> {
  try {
    const expired = await expireEligibleOffers();
    if (expired > 0) {
      app.log.info({ expired }, "offer expiry completed");
    }
  } catch (err) {
    app.log.info({ err }, "offer expiry failed");
  }
}

/**
 * Phase 6 document deadline expiry. Documents whose upload/review/retention
 * window passed are moved to EXPIRED through the document state machine
 * (audited, idempotent worker). Abortive replacement versions expire without
 * touching their live parent.
 */
async function runDocumentExpiry(app: {
  log: { info: (o: object, m: string) => void };
}): Promise<void> {
  try {
    const expired = await expireEligibleDocuments();
    if (expired > 0) {
      app.log.info({ expired }, "document expiry completed");
    }
  } catch (err) {
    app.log.info({ err }, "document expiry failed");
  }
}

/**
 * Phase 6 requirement deadline expiry. OPEN/SUBMITTED requirements whose
 * dueAt passed are moved to EXPIRED (audited, idempotent worker); they leave
 * readiness scope rather than re-blocking.
 */
async function runRequirementExpiry(app: {
  log: { info: (o: object, m: string) => void };
}): Promise<void> {
  try {
    const expired = await expireEligibleRequirements();
    if (expired > 0) {
      app.log.info({ expired }, "requirement expiry completed");
    }
  } catch (err) {
    app.log.info({ err }, "requirement expiry failed");
  }
}

async function start(): Promise<void> {
  const env = getEnv();

  const app = await buildApp();

  const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  let shuttingDown = false;

  // Periodic removal of expired sessions/verification/reset tokens, plus the
  // deal, offer, document, and requirement deadline-expiry sweeps. Each job is
  // isolated, logged, and never takes down the process on failure.
  const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  const cleanupTimer = setInterval(() => {
    void runAuthCleanup(app);
    void runDealExpiry(app);
    void runOfferExpiry(app);
    void runDocumentExpiry(app);
    void runRequirementExpiry(app);
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
  void runAuthCleanup(app);
  void runDealExpiry(app);
  void runOfferExpiry(app);
  void runDocumentExpiry(app);
  void runRequirementExpiry(app);

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutdown initiated");

    try {
      clearInterval(cleanupTimer);
      await app.close();
      app.log.info("http server closed");
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      process.exit(0);
    }
  };

  for (const signal of shutdownSignals) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }

  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(
      `${envDescription()} — listening on http://${env.HOST}:${env.PORT}`,
    );
  } catch (err) {
    app.log.error({ err }, "failed to start server");
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
}

void start();
