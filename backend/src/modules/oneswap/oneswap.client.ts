import { getEnv } from "../../config/env.js";
import { AppError } from "../../lib/errors/index.js";

/**
 * OneSwap Integration (Phase 11) — HTTP client.
 *
 * Calls the OneSwap external API (via server-side only — API key is NEVER
 * exposed to the browser). Implements:
 *   - getQuote          → GET  /quotes
 *   - createSwap        → POST /swaps
 *   - getSwapStatus     → GET  /swaps/{id}
 *   - getPoolInfo       → GET  /pools/{address}
 *   - addLiquidity      → POST /liquidity/add
 *   - removeLiquidity   → POST /liquidity/remove
 *
 * On any non-2xx or network failure the error is mapped to an AppError with
 * a stable ONESWAP_* code so internals never reach the browser.
 */

export interface OneSwapQuoteParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  slippageTolerance: number;
}

export interface OneSwapSwapParams {
  fromChain: string;
  toChain: string;
  fromToken: string;
  toToken: string;
  fromAmount: string;
  expectedToAmount: string;
  slippageTolerance: number;
  walletAddress: string;
}

export interface OneSwapLiquidityParams {
  chain: string;
  poolAddress: string;
  walletAddress: string;
  slippageTolerance: number;
  token0Amount?: string;
  token1Amount?: string;
  lpTokenAmount?: string;
}

export interface OneSwapClient {
  readonly name: string;
  getQuote(params: OneSwapQuoteParams): Promise<unknown>;
  createSwap(params: OneSwapSwapParams): Promise<{ swapId: string; status: string }>;
  getSwapStatus(swapId: string): Promise<unknown>;
  getPoolInfo(chain: string, poolAddress: string): Promise<unknown>;
  addLiquidity(params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }>;
  removeLiquidity(params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }>;
}

// ---------------------------------------------------------------------------
// Deterministic mock client for development / when no key is configured
// ---------------------------------------------------------------------------

const MOCK_POOLS: Record<string, unknown> = {
  default: {
    poolAddress: "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
    chain: "ethereum",
    token0: { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
    token1: { symbol: "ETH",  address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" },
    liquidity: "812000000",
    volumeUsd24h: "45230000",
    feeTier: 0.3,
    apr: 12.4,
  },
};

function mockQuote(params: OneSwapQuoteParams): unknown {
  const rate = params.fromToken.toUpperCase() === "ETH" ? 3420 : 0.000292;
  const toAmount = (parseFloat(params.fromAmount) * rate).toFixed(6);
  return {
    quoteId: `mock-q-${Date.now()}`,
    fromChain: params.fromChain,
    toChain: params.toChain,
    fromToken: params.fromToken,
    toToken: params.toToken,
    fromAmount: params.fromAmount,
    toAmount,
    estimatedGas: "0.0014",
    priceImpact: 0.12,
    route: [
      { protocol: "UniswapV3", portion: 0.7 },
      { protocol: "Curve",     portion: 0.3 },
    ],
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

class MockOneSwapClient implements OneSwapClient {
  readonly name = "mock-oneswap";

  async getQuote(params: OneSwapQuoteParams): Promise<unknown> {
    await delay(120);
    return mockQuote(params);
  }

  async createSwap(_params: OneSwapSwapParams): Promise<{ swapId: string; status: string }> {
    await delay(200);
    return { swapId: `mock-swap-${Date.now()}`, status: "PENDING" };
  }

  async getSwapStatus(swapId: string): Promise<unknown> {
    await delay(80);
    return {
      swapId,
      status: "COMPLETED",
      txHash: `0x${swapId.replace(/\D/g, "").padStart(64, "a")}`,
      completedAt: new Date().toISOString(),
    };
  }

  async getPoolInfo(_chain: string, poolAddress: string): Promise<unknown> {
    await delay(100);
    return MOCK_POOLS[poolAddress] ?? MOCK_POOLS.default;
  }

  async addLiquidity(_params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }> {
    await delay(200);
    return { txId: `mock-lp-add-${Date.now()}`, status: "PENDING" };
  }

  async removeLiquidity(_params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }> {
    await delay(200);
    return { txId: `mock-lp-rem-${Date.now()}`, status: "PENDING" };
  }
}

// ---------------------------------------------------------------------------
// Real HTTP client (calls OneSwap API)
// ---------------------------------------------------------------------------

async function fetchJson(
  url: string,
  apiKey: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    if (!res.ok) {
      throw new AppError({
        statusCode: 502,
        code: "ONESWAP_API_ERROR",
        message: "OneSwap API request failed.",
        expose: false,
      });
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") {
      throw new AppError({
        statusCode: 504,
        code: "ONESWAP_TIMEOUT",
        message: "OneSwap request timed out.",
      });
    }
    if (err instanceof AppError) throw err;
    throw new AppError({
      statusCode: 502,
      code: "ONESWAP_NETWORK",
      message: "OneSwap network request failed.",
      expose: false,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

class HttpOneSwapClient implements OneSwapClient {
  readonly name = "oneswap";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, apiKey: string, timeoutMs = 15_000) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async getQuote(params: OneSwapQuoteParams): Promise<unknown> {
    const sp = new URLSearchParams({
      fromChain: params.fromChain,
      toChain: params.toChain,
      fromToken: params.fromToken,
      toToken: params.toToken,
      fromAmount: params.fromAmount,
      slippage: String(params.slippageTolerance),
    });
    return fetchJson(
      `${this.baseUrl}/quotes?${sp.toString()}`,
      this.apiKey,
      { method: "GET" },
      this.timeoutMs,
    );
  }

  async createSwap(params: OneSwapSwapParams): Promise<{ swapId: string; status: string }> {
    const result = await fetchJson(
      `${this.baseUrl}/swaps`,
      this.apiKey,
      { method: "POST", body: JSON.stringify(params) },
      this.timeoutMs,
    );
    return result as { swapId: string; status: string };
  }

  async getSwapStatus(swapId: string): Promise<unknown> {
    return fetchJson(
      `${this.baseUrl}/swaps/${encodeURIComponent(swapId)}`,
      this.apiKey,
      { method: "GET" },
      this.timeoutMs,
    );
  }

  async getPoolInfo(chain: string, poolAddress: string): Promise<unknown> {
    return fetchJson(
      `${this.baseUrl}/pools/${encodeURIComponent(poolAddress)}?chain=${encodeURIComponent(chain)}`,
      this.apiKey,
      { method: "GET" },
      this.timeoutMs,
    );
  }

  async addLiquidity(params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }> {
    const result = await fetchJson(
      `${this.baseUrl}/liquidity/add`,
      this.apiKey,
      { method: "POST", body: JSON.stringify(params) },
      this.timeoutMs,
    );
    return result as { txId: string; status: string };
  }

  async removeLiquidity(params: OneSwapLiquidityParams): Promise<{ txId: string; status: string }> {
    const result = await fetchJson(
      `${this.baseUrl}/liquidity/remove`,
      this.apiKey,
      { method: "POST", body: JSON.stringify(params) },
      this.timeoutMs,
    );
    return result as { txId: string; status: string };
  }
}

// ---------------------------------------------------------------------------
// Singleton factory + test injection
// ---------------------------------------------------------------------------

let _client: OneSwapClient | null = null;

export function getOneSwapClient(): OneSwapClient {
  if (_client) return _client;
  const env = getEnv();
  const apiKey = (env as Record<string, unknown>).ONESWAP_API_KEY as string | undefined;
  const baseUrl = (env as Record<string, unknown>).ONESWAP_API_URL as string | undefined;

  if (!apiKey || !baseUrl) {
    _client = new MockOneSwapClient();
  } else {
    const timeoutMs = ((env as Record<string, unknown>).ONESWAP_TIMEOUT_MS as number | undefined) ?? 15_000;
    _client = new HttpOneSwapClient(baseUrl, apiKey, timeoutMs);
  }
  return _client;
}

/** Dependency-injection hook for integration tests. */
export function setOneSwapClientForTesting(c: OneSwapClient): void {
  _client = c;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
