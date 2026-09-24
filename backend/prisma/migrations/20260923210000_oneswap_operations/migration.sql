CREATE TABLE "OneSwapOperation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "operationType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATING',
    "providerReference" TEXT,
    "providerStatus" TEXT,
    "idempotencyKeyHash" VARCHAR(64) NOT NULL,
    "idempotencyPayloadHash" VARCHAR(64) NOT NULL,
    "request" JSONB NOT NULL,
    "providerResponse" JSONB,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OneSwapOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OneSwapOperation_organizationId_idempotencyKeyHash_key"
    ON "OneSwapOperation"("organizationId", "idempotencyKeyHash");
CREATE UNIQUE INDEX "OneSwapOperation_organizationId_providerReference_key"
    ON "OneSwapOperation"("organizationId", "providerReference");
CREATE INDEX "OneSwapOperation_organizationId_dealId_status_idx"
    ON "OneSwapOperation"("organizationId", "dealId", "status");
CREATE INDEX "OneSwapOperation_providerReference_idx"
    ON "OneSwapOperation"("providerReference");
CREATE INDEX "OneSwapOperation_requestedByUserId_createdAt_idx"
    ON "OneSwapOperation"("requestedByUserId", "createdAt");

ALTER TABLE "OneSwapOperation"
    ADD CONSTRAINT "OneSwapOperation_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OneSwapOperation"
    ADD CONSTRAINT "OneSwapOperation_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "Deal"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OneSwapOperation"
    ADD CONSTRAINT "OneSwapOperation_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
