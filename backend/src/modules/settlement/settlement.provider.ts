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
      throw new Error(
        "SETTLEMENT_PROVIDER=canton was selected, but the live Canton settlement adapter is not implemented. Refusing to simulate settlement.",
      );
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
