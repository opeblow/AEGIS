import { getEnv } from "../../config/env.js";
import type { SettlementProviderInterface } from "./settlement.types.js";
import { cantonMockProvider } from "./canton/canton.provider.js";

let settlementProviderInstance: SettlementProviderInterface | null = null;

export function getSettlementProvider(): SettlementProviderInterface {
  if (settlementProviderInstance) {
    return settlementProviderInstance;
  }

  const env = getEnv();
  const providerName = env.SETTLEMENT_PROVIDER ?? "mock";

  switch (providerName.toLowerCase()) {
    case "canton":
      // Real Canton provider would be imported here when available
      // For now, fall back to mock with a warning
      console.warn(
        "[SETTLEMENT] SETTLEMENT_PROVIDER=canton requested but real Canton provider not implemented. Using MOCK provider.",
      );
      settlementProviderInstance = cantonMockProvider;
      break;
    case "mock":
    default:
      settlementProviderInstance = cantonMockProvider;
      break;
  }

  return settlementProviderInstance;
}

export const settlementProvider = getSettlementProvider();

export function setSettlementProviderForTesting(provider: SettlementProviderInterface): void {
  settlementProviderInstance = provider;
}