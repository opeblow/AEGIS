-- CreateEnum
CREATE TYPE "DealIntelligenceRunStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "DealIntelligenceRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "status" "DealIntelligenceRunStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "modelVersion" TEXT,
    "analysisVersion" TEXT,
    "inputHash" VARCHAR(64) NOT NULL,
    "result" JSONB,
    "confidenceSummary" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealIntelligenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealIntelligenceRun_dealId_createdAt_idx" ON "DealIntelligenceRun"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealIntelligenceRun_organizationId_status_idx" ON "DealIntelligenceRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DealIntelligenceRun_dealId_status_idx" ON "DealIntelligenceRun"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealIntelligenceRun_inputHash_idx" ON "DealIntelligenceRun"("inputHash");

-- AddForeignKey
ALTER TABLE "DealIntelligenceRun" ADD CONSTRAINT "DealIntelligenceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealIntelligenceRun" ADD CONSTRAINT "DealIntelligenceRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealIntelligenceRun" ADD CONSTRAINT "DealIntelligenceRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
