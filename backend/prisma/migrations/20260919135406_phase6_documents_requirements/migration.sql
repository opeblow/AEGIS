-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('UPLOADING', 'UPLOADED', 'SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "DocumentVisibility" AS ENUM ('PRIVATE', 'PARTICIPANTS', 'DEAL_OWNER', 'SPECIFIC_PARTICIPANTS');

-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('OPEN', 'SUBMITTED', 'SATISFIED', 'REJECTED', 'WAIVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('DOCUMENT', 'INFORMATION', 'CONFIRMATION');

-- CreateTable
CREATE TABLE "DealDocument" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "documentType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "DocumentVisibility" NOT NULL DEFAULT 'PRIVATE',
    "status" "DocumentStatus" NOT NULL DEFAULT 'UPLOADING',
    "chainId" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" UUID,
    "storageKey" TEXT,
    "originalFilename" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" VARCHAR(64),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reviewerUserId" UUID,
    "reviewComment" TEXT,
    "idempotencyKeyHash" VARCHAR(64),
    "idempotencyPayloadHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDocumentTransition" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "DocumentStatus" NOT NULL,
    "toStatus" "DocumentStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocumentTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealDocumentVisibilityParticipant" (
    "documentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealDocumentVisibilityParticipant_pkey" PRIMARY KEY ("documentId","organizationId")
);

-- CreateTable
CREATE TABLE "DealRequirement" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "createdByUserId" UUID NOT NULL,
    "requirementType" "RequirementType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RequirementStatus" NOT NULL DEFAULT 'OPEN',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "dueAt" TIMESTAMP(3),
    "assignedOrganizationId" UUID,
    "satisfiedAt" TIMESTAMP(3),
    "satisfiedByUserId" UUID,
    "rejectionReason" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waivedByUserId" UUID,
    "idempotencyKeyHash" VARCHAR(64),
    "idempotencyPayloadHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealRequirementTransition" (
    "id" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "RequirementStatus" NOT NULL,
    "toStatus" "RequirementStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealRequirementTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDocument" (
    "requirementId" UUID NOT NULL,
    "documentGroupId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "attachedByUserId" UUID NOT NULL,
    "attachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementDocument_pkey" PRIMARY KEY ("requirementId","documentGroupId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DealDocument_storageKey_key" ON "DealDocument"("storageKey");

-- CreateIndex
CREATE INDEX "DealDocument_chainId_idx" ON "DealDocument"("chainId");

-- CreateIndex
CREATE INDEX "DealDocument_dealId_status_idx" ON "DealDocument"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealDocument_dealId_organizationId_idx" ON "DealDocument"("dealId", "organizationId");

-- CreateIndex
CREATE INDEX "DealDocument_dealId_visibility_idx" ON "DealDocument"("dealId", "visibility");

-- CreateIndex
CREATE INDEX "DealDocument_organizationId_status_idx" ON "DealDocument"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DealDocument_supersedesId_idx" ON "DealDocument"("supersedesId");

-- CreateIndex
CREATE INDEX "DealDocument_status_expiresAt_idx" ON "DealDocument"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "DealDocument_createdByUserId_idx" ON "DealDocument"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealDocument_dealId_organizationId_idempotencyKeyHash_key" ON "DealDocument"("dealId", "organizationId", "idempotencyKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "DealDocument_chainId_version_key" ON "DealDocument"("chainId", "version");

-- CreateIndex
CREATE INDEX "DealDocumentTransition_dealId_createdAt_idx" ON "DealDocumentTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealDocumentTransition_documentId_createdAt_idx" ON "DealDocumentTransition"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DealDocumentTransition_dealId_fromStatus_toStatus_idx" ON "DealDocumentTransition"("dealId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "DealDocumentTransition_actorUserId_idx" ON "DealDocumentTransition"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealDocumentTransition_documentId_requestId_toStatus_key" ON "DealDocumentTransition"("documentId", "requestId", "toStatus");

-- CreateIndex
CREATE INDEX "DealDocumentVisibilityParticipant_organizationId_idx" ON "DealDocumentVisibilityParticipant"("organizationId");

-- CreateIndex
CREATE INDEX "DealRequirement_dealId_status_idx" ON "DealRequirement"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealRequirement_dealId_assignedOrganizationId_idx" ON "DealRequirement"("dealId", "assignedOrganizationId");

-- CreateIndex
CREATE INDEX "DealRequirement_assignedOrganizationId_status_idx" ON "DealRequirement"("assignedOrganizationId", "status");

-- CreateIndex
CREATE INDEX "DealRequirement_status_dueAt_idx" ON "DealRequirement"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DealRequirement_createdByUserId_idx" ON "DealRequirement"("createdByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealRequirement_dealId_organizationId_idempotencyKeyHash_key" ON "DealRequirement"("dealId", "organizationId", "idempotencyKeyHash");

-- CreateIndex
CREATE INDEX "DealRequirementTransition_dealId_createdAt_idx" ON "DealRequirementTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealRequirementTransition_requirementId_createdAt_idx" ON "DealRequirementTransition"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "DealRequirementTransition_dealId_fromStatus_toStatus_idx" ON "DealRequirementTransition"("dealId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "DealRequirementTransition_actorUserId_idx" ON "DealRequirementTransition"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealRequirementTransition_requirementId_requestId_toStatus_key" ON "DealRequirementTransition"("requirementId", "requestId", "toStatus");

-- CreateIndex
CREATE INDEX "RequirementDocument_documentId_idx" ON "RequirementDocument"("documentId");

-- CreateIndex
CREATE INDEX "RequirementDocument_organizationId_idx" ON "RequirementDocument"("organizationId");

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_reviewerUserId_fkey" FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocument" ADD CONSTRAINT "DealDocument_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "DealDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentTransition" ADD CONSTRAINT "DealDocumentTransition_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DealDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentTransition" ADD CONSTRAINT "DealDocumentTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentTransition" ADD CONSTRAINT "DealDocumentTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentTransition" ADD CONSTRAINT "DealDocumentTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentVisibilityParticipant" ADD CONSTRAINT "DealDocumentVisibilityParticipant_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DealDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealDocumentVisibilityParticipant" ADD CONSTRAINT "DealDocumentVisibilityParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_assignedOrganizationId_fkey" FOREIGN KEY ("assignedOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_satisfiedByUserId_fkey" FOREIGN KEY ("satisfiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirement" ADD CONSTRAINT "DealRequirement_waivedByUserId_fkey" FOREIGN KEY ("waivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirementTransition" ADD CONSTRAINT "DealRequirementTransition_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "DealRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirementTransition" ADD CONSTRAINT "DealRequirementTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirementTransition" ADD CONSTRAINT "DealRequirementTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealRequirementTransition" ADD CONSTRAINT "DealRequirementTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "DealRequirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DealDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_attachedByUserId_fkey" FOREIGN KEY ("attachedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
