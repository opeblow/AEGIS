/**
 * Offline OneSwap stand-in for demonstrations.
 *
 * The real client (`oneswap.client.ts`) is used whenever `ONESWAP_API_KEY` is
 * configured. This client exists so a pitch or a recorded demo can drive the
 * full Metatarz -> OneSwap -> Canton flow on a laptop with no integrator
 * account. It is selected ONLY when `DEMO_MODE=true` is set AND no API key is
 * present, so it can never shadow the real provider.
 *
 * Everything it returns is fabricated and deterministic. Records it creates are
 * tagged `demo: true` so the UI can label them, and the settlement provider
 * treats a demo operation as locally confirmed instead of calling the ledger.
 * It performs no network I/O.
 */
import type {
  OneSwapClient,
  OneSwapQuoteParams,
  OneSwapSwapParams,
} from "./oneswap.client.js";
import { AppError } from "../../lib/errors/index.js";

/** Canonical demo prices used to build quotes. */
const DEMO_PRICES: Record<string, number> = {
  "CC/USDCx": 1.0,
  "CC/HANDL": 0.0024,
  "CC/CBTC": 64120.5,
  "CC/cETH": 3184.22,
};

const FEE_BPS = 30; // 0.30% demo fee

const DEMO_TOKENS = [
  { symbol: "CC", name: "Canton Coin", address: "0x0000000000000000000000000000000000000000", decimals: 18, isNative: true },
  { symbol: "USDCx", name: "Canton Circle USD", address: "0xDE40000000000000000000000000000000000001", decimals: 18, isNative: false },
  { symbol: "HANDL", name: "HANDL", address: "0xDE50000000000000000000000000000000000001", decimals: 18, isNative: false },
  { symbol: "CBTC", name: "Canton Bitcoin", address: "0xDE60000000000000000000000000000000000001", decimals: 18, isNative: false },
  { symbol: "cETH", name: "Canton Ether", address: "0xDE70000000000000000000000000000000000001", decimals: 18, isNative: false },
] as const;

const DEMO_POOLS = [
  { poolId: "demo-pool-cc-usdcx", symbol: "CC/USDCx", inSymbol: "CC", outSymbol: "USDCx", feeBps: FEE_BPS, tvl: 48_500_000 },
  { poolId: "demo-pool-cc-cbtc", symbol: "CC/CBTC", inSymbol: "CC", outSymbol: "CBTC", feeBps: FEE_BPS, tvl: 12_900_000 },
  { poolId: "demo-pool-cc-ceth", symbol: "CC/cETH", inSymbol: "CC", outSymbol: "cETH", feeBps: FEE_BPS, tvl: 8_240_000 },
];

function rateFor(from: string, to: string): number {
  const direct = DEMO_PRICES[`${from}/${to}`];
  if (direct !== undefined) return direct;
  const inverse = DEMO_PRICES[`${to}/${from}`];
  if (inverse !== undefined) return 1 / inverse;
  throw new AppError({
    statusCode: 400,
    code: "ONESWAP_NO_DEMO_ROUTE",
    message: `No demo liquidity route exists for ${from} -> ${to}.`,
  });
}

interface DemoSwapRecord {
  id: string;
  userRef: string;
  inSymbol: string;
  outSymbol: string;
  amountIn: number;
  amountOut: number;
  status: string;
  depositParty: string;
  poolId: string;
  createdAt: number;
  depositUpdateId?: string;
}

/** Swap lifecycle a demo can walk through: awaiting deposit -> filled. */
const SWAP_STATUSES = ["deposit_pending", "deposit_detected", "completed"] as const;

export class DemoOneSwapClient implements OneSwapClient {
  readonly name = "oneswap-demo";
  private readonly swaps = new Map<string, DemoSwapRecord>();

  constructor(private readonly depositParty: string) {}

  async getQuote(params: OneSwapQuoteParams) {
    const rate = rateFor(params.from, params.to);
    const gross = params.amount * rate;
    const fee = gross * (FEE_BPS / 10_000);
    const net = gross - fee;
    return {
      inSymbol: params.from,
      outSymbol: params.to,
      inAmount: String(params.amount),
      toAmount: net.toFixed(8),
      toAmountWithoutFee: net.toFixed(8),
      fee: fee.toFixed(8),
      priceImpact: "0.04",
      poolId: params.poolId ?? `demo-pool-cc-${params.to.toLowerCase()}`,
      rate: String(rate),
      demo: true,
    } as never;
  }

  async createSwap(params: OneSwapSwapParams) {
    const rate = rateFor(params.inSymbol, params.outSymbol);
    const gross = params.amountIn * rate;
    const net = gross - gross * (FEE_BPS / 10_000);
    const id = `demo-swap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const minOut = params.minOut ?? net;
    const record: DemoSwapRecord = {
      id,
      userRef: params.userRef,
      inSymbol: params.inSymbol,
      outSymbol: params.outSymbol,
      amountIn: params.amountIn,
      amountOut: net,
      status: SWAP_STATUSES[0],
      depositParty: this.depositParty,
      poolId: params.poolId ?? `demo-pool-cc-${params.outSymbol.toLowerCase()}`,
      createdAt: Date.now(),
    };
    this.swaps.set(id, record);
    return {
      id,
      swapId: id,
      status: record.status,
      inSymbol: record.inSymbol,
      outSymbol: record.outSymbol,
      amountIn: String(record.amountIn),
      expectedOut: net.toFixed(8),
      minOut: String(minOut),
      poolId: record.poolId,
      poolType: "demo-concentrated",
      depositParty: this.depositParty,
      slippageBps: params.slippageBps ?? 50,
      createdAt: new Date(record.createdAt).toISOString(),
      demo: true,
    } as never;
  }

  async getSwapStatus(swapId: string) {
    const record = this.requireSwap(swapId);
    return {
      id: record.id,
      swapId: record.id,
      status: record.status,
      inSymbol: record.inSymbol,
      outSymbol: record.outSymbol,
      amountIn: String(record.amountIn),
      toAmount: record.amountOut.toFixed(8),
      minOut: String(record.amountOut),
      poolId: record.poolId,
      depositParty: record.depositParty,
      demo: true,
    } as never;
  }

  async getOpenSwap(userRef: string) {
    const open = [...this.swaps.values()]
      .filter((s) => s.userRef === userRef && s.status !== "completed")
      .sort((a, b) => b.createdAt - a.createdAt)[0];
    return open ? await this.getSwapStatus(open.id) : null;
  }

  async cancelSwap(swapId: string) {
    const record = this.requireSwap(swapId);
    record.status = "cancelled";
    return this.getSwapStatus(swapId);
  }

  async getPoolInfo(poolId: string) {
    const pool = DEMO_POOLS.find((p) => p.poolId === poolId) ?? DEMO_POOLS[0];
    return {
      ...pool,
      poolAddress: `0x${pool.poolId.replace(/-/g, "").padEnd(40, "0")}`,
      feeBps: pool.feeBps,
      liquidity: String(pool.tvl),
      demo: true,
    } as never;
  }

  async getPoolTicker(poolId: string) {
    const pool = DEMO_POOLS.find((p) => p.poolId === poolId) ?? DEMO_POOLS[0];
    const rate = rateFor(pool.inSymbol, pool.outSymbol);
    return {
      poolId: pool.poolId,
      lastPrice: String(rate),
      price: String(rate),
      bidPrice: String(rate * 0.999),
      askPrice: String(rate * 1.001),
      priceChangePercent24: "0.42",
      volume24h: String(pool.tvl * 0.03),
      liquidity: String(pool.tvl),
      timestamp: Date.now(),
      demo: true,
    } as never;
  }

  async getPools() {
    return DEMO_POOLS.map((p) => ({ ...p, demo: true })) as never;
  }

  async getTokens() {
    return DEMO_TOKENS.map((t) => ({ ...t, demo: true })) as never;
  }

  /**
   * Records a demo deposit and advances the swap one step toward completion.
   * Called by the deposit endpoint instead of the ledger verification path.
   */
  async recordDemoDeposit(swapId: string, updateId: string): Promise<void> {
    const record = this.requireSwap(swapId);
    const index = SWAP_STATUSES.indexOf(record.status as (typeof SWAP_STATUSES)[number]);
    const next = SWAP_STATUSES[Math.min(index + 1, SWAP_STATUSES.length - 1)];
    record.status = next;
    record.depositUpdateId = updateId;
  }

  private requireSwap(swapId: string): DemoSwapRecord {
    const record = this.swaps.get(swapId);
    if (!record) {
      throw new AppError({
        statusCode: 404,
        code: "ONESWAP_SWAP_NOT_FOUND",
        message: "Demo swap not found.",
      });
    }
    return record;
  }
}

let demoInstance: DemoOneSwapClient | null = null;

export function getDemoOneSwapClient(): DemoOneSwapClient {
  demoInstance ??= new DemoOneSwapClient(
    process.env.DEMO_DEPOSIT_PARTY ?? "0xDE40000000000000000000000000000000000009",
  );
  return demoInstance;
}