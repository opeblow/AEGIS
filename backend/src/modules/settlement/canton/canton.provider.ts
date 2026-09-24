import { AppError } from "../../../lib/errors/index.js";
import {
  getMetatarzRpcClient,
  type MetatarzRpcClient,
} from "./metatarz/metatarz.client.js";
import type { SettlementProviderInterface, SettlementSubmissionPayload, SettlementProviderSubmitResult, SettlementProviderStatusResult, SettlementProviderType } from "../settlement.types.js";

/**
 * Live Canton settlement through the Metatarz non-custodial wallet.
 *
 * Users sign CC/CIP-56 transfers in their own browser wallet (Metatarz, which
 * speaks EIP-1193 and returns a Canton `update_id` per transfer). The backend
 * never holds a private key: `submit` only verifies the executed transfer's
 * update id against the Metatarz EVM shim and records it as the settlement's
 * external reference. `getStatus` polls the shim until the Canton update is
 * visible on the ledger.
 */
export class CantonMetatarzProvider implements SettlementProviderInterface {
  readonly name: SettlementProviderType = "CANTON";

  constructor(private readonly rpc: MetatarzRpcClient = getMetatarzRpcClient()) {}

  async submit(
    _settlementId: string,
    payload: SettlementSubmissionPayload,
  ): Promise<SettlementProviderSubmitResult> {
    const metadata = (payload.metadata ?? {}) as Record<string, unknown>;
    const updateId = typeof metadata.updateId === "string" ? metadata.updateId : null;
    if (!updateId) {
      throw new AppError({
        statusCode: 409,
        code: "CANTON_SIGNATURE_REQUIRED",
        message:
          "A Canton transfer must be executed in the user's wallet first. " +
          "Connect Metatarz, pay the settlement amount, then submit with the returned update id.",
      });
    }

    const submittedAt = new Date();
    const confirmed = await this.rpc.hasConfirmedTransaction(updateId);

    return {
      providerReference: updateId,
      externalTransactionId: updateId,
      status: confirmed ? "SETTLED" : "PENDING",
      submittedAt,
    };
  }

  async getStatus(
    providerReference: string,
  ): Promise<SettlementProviderStatusResult> {
    const confirmed = await this.rpc.hasConfirmedTransaction(providerReference);
    return {
      providerReference,
      externalTransactionId: providerReference,
      status: confirmed ? "SETTLED" : "PENDING",
      checkedAt: new Date(),
    };
  }

  /** A signed Canton transfer cannot be revoked; local lifecycle handles cancels. */
  async cancel(): Promise<void> {
    return;
  }
}

export class CantonMockProvider implements SettlementProviderInterface {
  readonly name: SettlementProviderType = "MOCK";

  private settlements = new Map<
    string,
    {
      providerReference: string;
      externalTransactionId: string;
      status: SettlementProviderSubmitResult["status"];
      submittedAt: Date;
    }
  >();

  async submit(
    settlementId: string,
    _payload: SettlementSubmissionPayload,
  ): Promise<SettlementProviderSubmitResult> {
    const providerReference = `MOCK-${Date.now()}-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const externalTransactionId = `EXT-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const submittedAt = new Date();

    const initialStatus: SettlementProviderSubmitResult["status"] = "SUBMITTED";

    this.settlements.set(settlementId, {
      providerReference,
      externalTransactionId,
      status: initialStatus,
      submittedAt,
    });

    return {
      providerReference,
      externalTransactionId,
      status: initialStatus,
      submittedAt,
    };
  }

  async getStatus(
    providerReference: string,
  ): Promise<SettlementProviderStatusResult> {
    for (const [settlementId, data] of this.settlements.entries()) {
      if (data.providerReference === providerReference) {
        let currentStatus = data.status;
        const now = Date.now();
        const elapsed = now - data.submittedAt.getTime();

        if (elapsed > 5000 && currentStatus === "SUBMITTED") {
          currentStatus = "PENDING";
        }
        if (elapsed > 15000 && currentStatus === "PENDING") {
          currentStatus = "SETTLED";
        }

        this.settlements.set(settlementId, { ...data, status: currentStatus });

        return {
          providerReference: data.providerReference,
          externalTransactionId: data.externalTransactionId,
          status: currentStatus,
          checkedAt: new Date(),
        };
      }
    }

    throw new Error(`Settlement with provider reference ${providerReference} not found`);
  }

  async cancel(providerReference: string): Promise<void> {
    for (const [settlementId, data] of this.settlements.entries()) {
      if (data.providerReference === providerReference) {
        if (data.status === "SETTLED" || data.status === "FAILED" || data.status === "CANCELLED") {
          throw new Error(`Cannot cancel settlement in status ${data.status}`);
        }
        this.settlements.set(settlementId, { ...data, status: "CANCELLED" });
        return;
      }
    }
    throw new Error(`Settlement with provider reference ${providerReference} not found`);
  }

  simulateCompletion(providerReference: string): void {
    for (const [settlementId, data] of this.settlements.entries()) {
      if (data.providerReference === providerReference) {
        this.settlements.set(settlementId, { ...data, status: "SETTLED" });
        return;
      }
    }
  }

  simulateFailure(providerReference: string): void {
    for (const [settlementId, data] of this.settlements.entries()) {
      if (data.providerReference === providerReference) {
        this.settlements.set(settlementId, { ...data, status: "FAILED" });
        return;
      }
    }
  }

  reset(): void {
    this.settlements.clear();
  }
}

export const cantonMockProvider = new CantonMockProvider();
export const cantonMetatarzProvider: SettlementProviderInterface =
  new CantonMetatarzProvider();