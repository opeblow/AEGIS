-- CreateEnum
CREATE TYPE "CounterpartyStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "CounterpartyVerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DealParticipantType" AS ENUM ('OWNER', 'COUNTERPARTY', 'OBSERVER');

-- CreateEnum
CREATE TYPE "DealParticipantStatus" AS ENUM ('INVITED', 'ACTIVE', 'DECLINED', 'REMOVED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'COUNTERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'EXPIRED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "OrganizationCounterparty" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "counterpartyOrganizationId" UUID NOT NULL,
    "pairKey" VARCHAR(64) NOT NULL,
    "status" "CounterpartyStatus" NOT NULL DEFAULT 'PENDING',
    "verificationStatus" "CounterpartyVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrganizationCounterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealParticipant" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "participantType" "DealParticipantType" NOT NULL DEFAULT 'COUNTERPARTY',
    "status" "DealParticipantStatus" NOT NULL DEFAULT 'INVITED',
    "invitedByUserId" UUID,
    "joinedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DealParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealParticipantTransition" (
    "id" UUID NOT NULL,
    "dealParticipantId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "DealParticipantStatus" NOT NULL,
    "toStatus" "DealParticipantStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealParticipantTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealParticipantInvitation" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "participantId" UUID,
    "email" TEXT NOT NULL,
    "participantType" "DealParticipantType" NOT NULL DEFAULT 'COUNTERPARTY',
    "tokenHash" TEXT NOT NULL,
    "invitedByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DealParticipantInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "createdByParticipantId" UUID NOT NULL,
    "recipientParticipantId" UUID NOT NULL,
    "parentOfferId" UUID,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(28,8) NOT NULL,
    "price" DECIMAL(28,8),
    "settlementDate" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "idempotencyKeyHash" VARCHAR(64),
    "idempotencyPayloadHash" VARCHAR(64),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferTransition" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "requestId" TEXT,
    "transitionType" TEXT NOT NULL,
    "fromStatus" "OfferStatus" NOT NULL,
    "toStatus" "OfferStatus" NOT NULL,
    "reason" TEXT,
    "actorUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCounterparty_pairKey_key" ON "OrganizationCounterparty"("pairKey");

-- CreateIndex
CREATE INDEX "OrganizationCounterparty_organizationId_status_idx" ON "OrganizationCounterparty"("organizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationCounterparty_counterpartyOrganizationId_idx" ON "OrganizationCounterparty"("counterpartyOrganizationId");

-- CreateIndex
CREATE INDEX "OrganizationCounterparty_counterpartyOrganizationId_status_idx" ON "OrganizationCounterparty"("counterpartyOrganizationId", "status");

-- CreateIndex
CREATE INDEX "OrganizationCounterparty_verificationStatus_idx" ON "OrganizationCounterparty"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationCounterparty_organizationId_counterpartyOrganiz_key" ON "OrganizationCounterparty"("organizationId", "counterpartyOrganizationId");

-- CreateIndex
CREATE INDEX "DealParticipant_organizationId_status_idx" ON "DealParticipant"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DealParticipant_dealId_status_idx" ON "DealParticipant"("dealId", "status");

-- CreateIndex
CREATE INDEX "DealParticipant_invitedByUserId_idx" ON "DealParticipant"("invitedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealParticipant_dealId_organizationId_key" ON "DealParticipant"("dealId", "organizationId");

-- CreateIndex
CREATE INDEX "DealParticipantTransition_dealId_createdAt_idx" ON "DealParticipantTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "DealParticipantTransition_organizationId_createdAt_idx" ON "DealParticipantTransition"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "DealParticipantTransition_dealParticipantId_createdAt_idx" ON "DealParticipantTransition"("dealParticipantId", "createdAt");

-- CreateIndex
CREATE INDEX "DealParticipantTransition_dealId_fromStatus_toStatus_idx" ON "DealParticipantTransition"("dealId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "DealParticipantTransition_actorUserId_idx" ON "DealParticipantTransition"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "DealParticipantTransition_dealParticipantId_requestId_toSta_key" ON "DealParticipantTransition"("dealParticipantId", "requestId", "toStatus");

-- CreateIndex
CREATE UNIQUE INDEX "DealParticipantInvitation_tokenHash_key" ON "DealParticipantInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "DealParticipantInvitation_dealId_idx" ON "DealParticipantInvitation"("dealId");

-- CreateIndex
CREATE INDEX "DealParticipantInvitation_organizationId_idx" ON "DealParticipantInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "DealParticipantInvitation_email_idx" ON "DealParticipantInvitation"("email");

-- CreateIndex
CREATE INDEX "DealParticipantInvitation_expiresAt_idx" ON "DealParticipantInvitation"("expiresAt");

-- CreateIndex
CREATE INDEX "Offer_dealId_status_idx" ON "Offer"("dealId", "status");

-- CreateIndex
CREATE INDEX "Offer_dealId_createdAt_idx" ON "Offer"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "Offer_createdByParticipantId_idx" ON "Offer"("createdByParticipantId");

-- CreateIndex
CREATE INDEX "Offer_recipientParticipantId_idx" ON "Offer"("recipientParticipantId");

-- CreateIndex
CREATE INDEX "Offer_parentOfferId_idx" ON "Offer"("parentOfferId");

-- CreateIndex
CREATE INDEX "Offer_status_idx" ON "Offer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_dealId_createdByParticipantId_idempotencyKeyHash_key" ON "Offer"("dealId", "createdByParticipantId", "idempotencyKeyHash");

-- CreateIndex
CREATE INDEX "OfferTransition_dealId_createdAt_idx" ON "OfferTransition"("dealId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferTransition_offerId_createdAt_idx" ON "OfferTransition"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "OfferTransition_dealId_fromStatus_toStatus_idx" ON "OfferTransition"("dealId", "fromStatus", "toStatus");

-- CreateIndex
CREATE INDEX "OfferTransition_actorUserId_idx" ON "OfferTransition"("actorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferTransition_offerId_requestId_toStatus_key" ON "OfferTransition"("offerId", "requestId", "toStatus");

-- AddForeignKey
ALTER TABLE "OrganizationCounterparty" ADD CONSTRAINT "OrganizationCounterparty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCounterparty" ADD CONSTRAINT "OrganizationCounterparty_counterpartyOrganizationId_fkey" FOREIGN KEY ("counterpartyOrganizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationCounterparty" ADD CONSTRAINT "OrganizationCounterparty_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipant" ADD CONSTRAINT "DealParticipant_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantTransition" ADD CONSTRAINT "DealParticipantTransition_dealParticipantId_fkey" FOREIGN KEY ("dealParticipantId") REFERENCES "DealParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantTransition" ADD CONSTRAINT "DealParticipantTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantTransition" ADD CONSTRAINT "DealParticipantTransition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantTransition" ADD CONSTRAINT "DealParticipantTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantInvitation" ADD CONSTRAINT "DealParticipantInvitation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantInvitation" ADD CONSTRAINT "DealParticipantInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantInvitation" ADD CONSTRAINT "DealParticipantInvitation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "DealParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealParticipantInvitation" ADD CONSTRAINT "DealParticipantInvitation_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_createdByParticipantId_fkey" FOREIGN KEY ("createdByParticipantId") REFERENCES "DealParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_recipientParticipantId_fkey" FOREIGN KEY ("recipientParticipantId") REFERENCES "DealParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_parentOfferId_fkey" FOREIGN KEY ("parentOfferId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTransition" ADD CONSTRAINT "OfferTransition_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTransition" ADD CONSTRAINT "OfferTransition_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferTransition" ADD CONSTRAINT "OfferTransition_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
