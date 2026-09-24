import { getEnv } from "../../config/env.js";
import type { SettlementProviderInterface } from "./settlement.types.js";
import { cantonMetatarzProvider, cantonMockProvider } from "./canton/canton.provider.js";

let settlementProviderInstance: SettlementProviderInterface | null = null;

export function getSettlementProvider(): SettlementProviderInterface {
  if (settlementProviderInstance) {
    return settlementProviderInstance;
  }

  const env = getEnv();
  const providerName = env.SETTLEMENT_PROVIDER ?? "mock";

  switch (providerName.toLowerCase()) {
    case "canton":
      // Live non-custodial Canton settlement via Metatarz: users sign CC/CIP-56
      // transfers in their browser and the backend verifies the update id.
      settlementProviderInstance = cantonMetatarzProvider;
      break;
    case "mock":
      if (env.NODE_ENV === "production") {
        throw new Error("Refusing to use the mock settlement provider in production.");
      }
      settlementProviderInstance = cantonMockProvider;
      break;
    default:
      throw new Error(`Unsupported settlement provider: ${providerName}`);
  }

  return settlementProviderInstance;
}

export const settlementProvider = getSettlementProvider();

export function setSettlementProviderForTesting(provider: SettlementProviderInterface): void {
  settlementProviderInstance = provider;
}
