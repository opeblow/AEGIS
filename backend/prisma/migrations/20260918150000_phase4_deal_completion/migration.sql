-- Phase 4 completion (Deal Management + Transaction State Engine)
--
-- Adds create idempotency columns to Deal and permits system-initiated
-- transitions (expiry worker) by making DealStateTransition.actorUserId
-- optional. All user-initiated transitions still record the authenticated
-- actor; only background jobs write system transitions with a null actor.

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN "idempotencyKeyHash" VARCHAR(64),
ADD COLUMN "idempotencyPayloadHash" VARCHAR(64);

-- AlterTable
ALTER TABLE "DealStateTransition" ALTER COLUMN "actorUserId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Deal_organizationId_idempotencyKeyHash_key" ON "Deal"("organizationId", "idempotencyKeyHash");