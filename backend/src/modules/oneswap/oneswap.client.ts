import {
  OneSwap,
  OneSwapError,
  type Pool,
  type PoolDetail,
  type PoolTicker,
  type QuoteResult,
  type Swap,
  type Token,
} from "@oneswap/sdk";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";

export interface OneSwapQuoteParams {
  from: string;
  to: string;
  amount: number;
  poolId?: string;
}

export interface OneSwapSwapParams {
  userRef: string;
  inSymbol: string;
  amountIn: number;
  outSymbol: string;
  poolId?: string;
  minOut?: number;
  slippageBps?: number;
}

export interface OneSwapClient {
  readonly name: string;
  getQuote(params: OneSwapQuoteParams): Promise<QuoteResult>;
  createSwap(params: OneSwapSwapParams): Promise<Swap>;
  getSwapStatus(swapId: string): Promise<Swap>;
  getOpenSwap(userRef: string): Promise<Swap | null>;
  cancelSwap(swapId: string): Promise<Swap>;
  getPoolInfo(poolId: string): Promise<PoolDetail>;
  getPoolTicker(poolId: string): Promise<PoolTicker>;
  getPools(): Promise<Pool[]>;
  getTokens(): Promise<Token[]>;
}

class OfficialOneSwapClient implements OneSwapClient {
  readonly name = "oneswap-canton-sdk";
  private readonly client: OneSwap;

  constructor(apiKey: string, environment: "mainnet" | "devnet", timeout: number) {
    this.client = new OneSwap({ apiKey, environment, timeout });
  }

  async getQuote(params: OneSwapQuoteParams): Promise<QuoteResult> {
    return this.call(() => this.client.quotes.get(params));
  }

  async createSwap(params: OneSwapSwapParams): Promise<Swap> {
    return this.call(() => this.client.swaps.createSwap(params));
  }

  async getSwapStatus(swapId: string): Promise<Swap> {
    return this.call(() => this.client.swaps.getSwap(swapId));
  }

  async getOpenSwap(userRef: string): Promise<Swap | null> {
    return this.call(() => this.client.swaps.getOpenSwap(userRef));
  }

  async cancelSwap(swapId: string): Promise<Swap> {
    return this.call(() => this.client.swaps.cancel(swapId));
  }

  async getPoolInfo(poolId: string): Promise<PoolDetail> {
    return this.call(() => this.client.pools.get(poolId));
  }

  async getPoolTicker(poolId: string): Promise<PoolTicker> {
    return this.call(() => this.client.pools.getTicker(poolId));
  }

  async getPools(): Promise<Pool[]> {
    return this.call(() => this.client.pools.list());
  }

  async getTokens(): Promise<Token[]> {
    return this.call(() => this.client.tokens.list());
  }

  private async call<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      const statusCode = cause instanceof OneSwapError ? cause.status : undefined;
      throw new AppError({
        statusCode: statusCode === 429 ? 503 : 502,
        code: statusCode === 429 ? "ONESWAP_RATE_LIMITED" : "ONESWAP_API_ERROR",
        message:
          statusCode === 429
            ? "OneSwap is rate limiting requests. Retry after a short delay."
            : "The OneSwap request could not be completed.",
        cause,
      });
    }
  }
}

let clientInstance: OneSwapClient | null = null;

/** Creates the real OneSwap client. No implicit mock or endpoint guessing. */
export function getOneSwapClient(): OneSwapClient {
  if (clientInstance) return clientInstance;

  const env = getEnv();
  const apiKey = env.ONESWAP_API_KEY?.trim();
  if (!apiKey) {
    throw new AppError({
      statusCode: 503,
      code: "ONESWAP_NOT_CONFIGURED",
      message: "OneSwap is unavailable until its API key is configured.",
    });
  }

  clientInstance = new OfficialOneSwapClient(
    apiKey,
    env.ONESWAP_ENVIRONMENT,
    env.ONESWAP_TIMEOUT_MS,
  );
  return clientInstance;
}

/** Dependency-injection hook for tests. */
export function setOneSwapClientForTesting(client: OneSwapClient | null): void {
  clientInstance = client;
}
