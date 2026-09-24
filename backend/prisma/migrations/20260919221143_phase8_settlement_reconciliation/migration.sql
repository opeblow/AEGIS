-- CreateEnum
CREATE TYPE "ApprovalPolicyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalRuleType" AS ENUM ('NOTIONAL_THRESHOLD', 'DEAL_TYPE', 'CURRENCY', 'REQUIRED_DOCUMENTS', 'REQUIRED_REQUIREMENTS', 'ROLE_APPROVAL', 'MULTI_APPROVER', 'SEQUENTIAL_APPROVAL', 'PARALLEL_APPROVAL');

-- CreateEnum
CREATE TYPE "ApprovalWorkflowStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecisionType" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementProvider" AS ENUM ('CANTON', 'MOCK');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('CREATED', 'SUBMITTING', 'SUBMITTED', 'PENDING', 'SETTLED', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('PENDING', 'MATCHED', 'MISMATCHED', 'FAILED', 'RESOLVED');

-- CreateTable
CREATE TABLE "ApprovalPolicy" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ApprovalPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalPolicyRule" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "ruleType" "ApprovalRuleType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalPolicyRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalWorkflow" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "status" "ApprovalWorkflowStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "policySnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "approverUserId" UUID NOT NULL,
    "approverRole" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "dueAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalDecision" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "workflowId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "decision" "ApprovalDecisionType" NOT NULL,
    "reason" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "provider" "SettlementProvider" NOT NULL DEFAULT 'MOCK',
    "providerReference" TEXT,
    "externalTransactionId" TEXT,
    "status" "SettlementStatus" NOT NULL DEFAULT 'CREATED',
    "amount" DECIMAL(28,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "assetIdentifier" TEXT,
    "initiatedByUserId" UUID NOT NULL,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "idempotencyKeyHash" VARCHAR(64),
    "idempotencyPayloadHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementTransition" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "SettlementStatus" NOT NULL,
    "toStatus" "SettlementStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettlementTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reconciliation" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "expectedAmount" DECIMAL(28,8) NOT NULL,
    "actualAmount" DECIMAL(28,8),
    "expectedCurrency" TEXT NOT NULL,
    "actualCurrency" TEXT,
    "expectedReference" TEXT,
    "actualReference" TEXT,
    "expectedState" TEXT NOT NULL,
    "actualState" TEXT,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'PENDING',
    "mismatchReason" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" UUID,
    "resolutionReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organizationId_idx" ON "ApprovalPolicy"("organizationId");

-- CreateIndex
CREATE INDEX "ApprovalPolicy_organizationId_status_idx" ON "ApprovalPolicy"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_policyId_idx" ON "ApprovalPolicyRule"("policyId");

-- CreateIndex
CREATE INDEX "ApprovalPolicyRule_policyId_ruleType_idx" ON "ApprovalPolicyRule"("policyId", "ruleType");

-- CreateIndex
CREATE INDEX "ApprovalWorkflow_organizationId_idx" ON "ApprovalWorkflow"("organizationId");

-- CreateIndex
CREATE INDEX "ApprovalWorkflow_organizationId_status_idx" ON "ApprovalWorkflow"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalWorkflow_dealId_key" ON "ApprovalWorkflow"("dealId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_workflowId_idx" ON "ApprovalRequest"("workflowId");

-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ApprovalRequest_approverUserId_status_idx" ON "ApprovalRequest"("approverUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_workflowId_approverUserId_key" ON "ApprovalRequest"("workflowId", "approverUserId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_workflowId_idx" ON "ApprovalDecision"("workflowId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_organizationId_idx" ON "ApprovalDecision"("organizationId");

-- CreateIndex
CREATE INDEX "ApprovalDecision_actorUserId_idx" ON "ApprovalDecision"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalDecision_requestId_key" ON "ApprovalDecision"("requestId");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_status_idx" ON "Settlement"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Settlement_organizationId_dealId_idx" ON "Settlement"("organizationId", "dealId");

-- CreateIndex
CREATE INDEX "Settlement_provider_providerReference_idx" ON "Settlement"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "Settlement_status_updatedAt_idx" ON "Settlement"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_dealId_key" ON "Settlement"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_organizationId_providerReference_key" ON "Settlement"("organizationId", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_organizationId_idempotencyKeyHash_key" ON "Settlement"("organizationId", "idempotencyKeyHash");

-- CreateIndex
CREATE INDEX "SettlementTransition_settlementId_createdAt_idx" ON "SettlementTransition"("settlementId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementTransition_dealId_createdAt_idx" ON "SettlementTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementTransition_organizationId_createdAt_idx" ON "SettlementTransition"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "SettlementTransition_settlementId_fromStatus_toStatus_idx" ON "SettlementTransition"("settlementId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "SettlementTransition_actorUserId_idx" ON "SettlementTransition"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementTransition_settlementId_requestId_toStatus_key" ON "SettlementTransition"("settlementId", "requestId", "toStatus");

-- CreateIndex
CREATE INDEX "Reconciliation_organizationId_status_idx" ON "Reconciliation"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Reconciliation_dealId_idx" ON "Reconciliation"("dealId");

-- CreateIndex
CREATE INDEX "Reconciliation_status_checkedAt_idx" ON "Reconciliation"("status", "checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_settlementId_key" ON "Reconciliation"("settlementId");

-- CreateIndex
CREATE UNIQUE INDEX "Reconciliation_dealId_key" ON "Reconciliation"("dealId");

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicy" ADD CONSTRAINT "ApprovalPolicy_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalPolicyRule" ADD CONSTRAINT "ApprovalPolicyRule_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalWorkflow" ADD CONSTRAINT "ApprovalWorkflow_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "ApprovalPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "ApprovalWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementTransition" ADD CONSTRAINT "SettlementTransition_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementTransition" ADD CONSTRAINT "SettlementTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementTransition" ADD CONSTRAINT "SettlementTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementTransition" ADD CONSTRAINT "SettlementTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
