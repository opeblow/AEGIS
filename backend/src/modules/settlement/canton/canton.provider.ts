import type { SettlementProviderInterface, SettlementSubmissionPayload, SettlementProviderSubmitResult, SettlementProviderStatusResult, SettlementProviderType } from "../settlement.types.js";

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