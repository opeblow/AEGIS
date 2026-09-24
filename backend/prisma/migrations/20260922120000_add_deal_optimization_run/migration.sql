-- CreateEnum
CREATE TYPE "DealOptimizationRunStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "DealOptimizationRun" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "requestedByUserId" UUID NOT NULL,
    "status" "DealOptimizationRunStatus" NOT NULL DEFAULT 'PENDING',
    "operation" TEXT NOT NULL DEFAULT 'OPTIMIZE',
    "optimizationVersion" TEXT,
    "solver" TEXT,
    "problemId" TEXT,
    "inputHash" VARCHAR(64) NOT NULL,
    "result" JSONB,
    "metrics" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealOptimizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealOptimizationRun_dealId_createdAt_idx" ON "DealOptimizationRun"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealOptimizationRun_organizationId_status_idx" ON "DealOptimizationRun"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DealOptimizationRun_dealId_status_idx" ON "DealOptimizationRun"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealOptimizationRun_inputHash_idx" ON "DealOptimizationRun"("inputHash");

-- AddForeignKey
ALTER TABLE "DealOptimizationRun" ADD CONSTRAINT "DealOptimizationRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealOptimizationRun" ADD CONSTRAINT "DealOptimizationRun_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealOptimizationRun" ADD CONSTRAINT "DealOptimizationRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;