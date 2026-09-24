-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('RWA_PURCHASE', 'RWA_SALE', 'PRIVATE_TRADE', 'OTHER');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('DRAFT', 'OPEN', 'NEGOTIATING', 'AGREED', 'APPROVAL_PENDING', 'APPROVED', 'SETTLEMENT_PENDING', 'SETTLED', 'RECONCILING', 'COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED', 'DISPUTED');

-- CreateTable
CREATE TABLE "Deal" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "DealType" NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'DRAFT',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "currency" TEXT NOT NULL,
    "notionalAmount" DECIMAL(28,8) NOT NULL,
    "settledAmount" DECIMAL(28,8),
    "settlementDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealStateTransition" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "DealStatus" NOT NULL,
    "toStatus" "DealStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealStateTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Deal_organizationId_status_idx" ON "Deal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Deal_organizationId_type_idx" ON "Deal"("organizationId", "type");

-- CreateIndex
CREATE INDEX "Deal_organizationId_createdAt_idx" ON "Deal"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Deal_createdByUserId_idx" ON "Deal"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Deal_organizationId_reference_key" ON "Deal"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "DealStateTransition_dealId_createdAt_idx" ON "DealStateTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealStateTransition_organizationId_createdAt_idx" ON "DealStateTransition"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DealStateTransition_dealId_fromStatus_toStatus_idx" ON "DealStateTransition"("dealId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "DealStateTransition_actorUserId_idx" ON "DealStateTransition"("actorUserId");

-- CreateIndex
CREATE INDEX "DealStateTransition_organizationId_createdAt_toStatus_idx" ON "DealStateTransition"("organizationId", "createdAt", "toStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DealStateTransition_dealId_requestId_toStatus_key" ON "DealStateTransition"("dealId", "requestId", "toStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DealStateTransition_organizationId_requestId_toStatus_key" ON "DealStateTransition"("organizationId", "requestId", "toStatus");

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStateTransition" ADD CONSTRAINT "DealStateTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStateTransition" ADD CONSTRAINT "DealStateTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealStateTransition" ADD CONSTRAINT "DealStateTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
