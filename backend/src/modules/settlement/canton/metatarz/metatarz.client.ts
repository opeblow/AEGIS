import { getEnv } from "../../../../config/env.js";
import { AppError } from "../../../../lib/errors/index.js";

/**
 * CIP-56 token registry exposed by the Metatarz EVM shim. Balances are always
 * read with 18-decimal conventions (there is no `decimals()` call) and map onto
 * hard-coded contract addresses, e.g. `0xDE4000…01` for USDCx.
 */
export const CIP56_TOKENS = [
  { symbol: "CC", address: "0x0000000000000000000000000000000000000000", native: true },
  { symbol: "USDCx", address: "0xDE40000000000000000000000000000000000001", native: false },
  { symbol: "HANDL", address: "0xDE50000000000000000000000000000000000001", native: false },
  { symbol: "CBTC", address: "0xDE60000000000000000000000000000000000001", native: false },
  { symbol: "cETH", address: "0xDE70000000000000000000000000000000000001", native: false },
] as const;

export interface CantonTokenBalance {
  symbol: string;
  address: string;
  /** Decimal string, 18-decimal convention (e.g. "1.5"). */
  balance: string;
}

export interface CantonTransactionReceipt {
  transactionHash: string;
  /** Canton update id; for Metatarz this is the ledger `update_id`. */
  status: "0x0" | "0x1" | string;
  blockNumber: string | null;
  blockHash: string | null;
  from: string | null;
  to: string | null;
  value?: string;
}

export interface MetatarzRpcClient {
  readonly name: string;
  getChainId(): Promise<number>;
  getCcnBalance(address: string): Promise<string>;
  getCip56TokenBalances(address: string): Promise<CantonTokenBalance[]>;
  getTransactionReceipt(updateId: string): Promise<CantonTransactionReceipt | null>;
  hasConfirmedTransaction(updateId: string): Promise<boolean>;
}

const BALANCE_OF_SELECTOR = "0x70a08231"; // balanceOf(address)

/** Hex string of a 32-byte left-padded Ethereum address. */
function encodeAddressArg(address: string): string {
  const clean = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new AppError({
      statusCode: 400,
      code: "CANTON_INVALID_ADDRESS",
      message: "A valid 0x EVM address is required for Canton balance reads.",
    });
  }
  return clean.padStart(64, "0");
}

/** `0x…` hex wei → decimal string with 18 decimals. */
export function formatWeiToEther(hexWei: string): string {
  const value = BigInt(hexWei);
  const whole = value / 10n ** 18n;
  const fraction = value % 10n ** 18n;
  const fracPadded = fraction.toString().padStart(18, "0").replace(/0+$/, "");
  return fracPadded ? `${whole}.${fracPadded}` : whole.toString();
}

function isValidUpdateId(value: string): boolean {
  return /^0x[0-9a-fA-F]{4,128}$/.test(value);
}

class OfficialMetatarzRpcClient implements MetatarzRpcClient {
  readonly name = "metatarz-canton-rpc";

  constructor(
    private readonly rpcUrl: string,
    private readonly chainId: number,
    private readonly timeoutMs: number,
  ) {}

  private async rpc<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new AppError({
          statusCode: 502,
          code: "METATARZ_RPC_ERROR",
          message: `Canton RPC responded with HTTP ${response.status}.`,
        });
      }
      const payload = (await response.json()) as {
        result?: unknown;
        error?: { code?: number; message?: string };
      };
      if (payload.error || payload.result === undefined) {
        throw new AppError({
          statusCode: 502,
          code: "METATARZ_RPC_ERROR",
          message: `Canton RPC error: ${payload.error?.message ?? "unknown"}`,
        });
      }
      return payload.result as T;
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError({
        statusCode: cause instanceof Error && cause.name === "AbortError" ? 504 : 502,
        code: "METATARZ_RPC_TIMEOUT",
        message:
          cause instanceof Error && cause.name === "AbortError"
            ? "Canton RPC request timed out."
            : "Canton RPC request could not be completed.",
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async getChainId(): Promise<number> {
    try {
      const value = await this.rpc<string>("eth_chainId", []);
      return Number.parseInt(value, 16);
    } catch {
      return this.chainId;
    }
  }

  async getCcnBalance(address: string): Promise<string> {
    const hex = await this.rpc<string>("eth_getBalance", [address, "latest"]);
    return formatWeiToEther(hex);
  }

  async getCip56TokenBalances(address: string): Promise<CantonTokenBalance[]> {
    const balances: CantonTokenBalance[] = [];
    for (const token of CIP56_TOKENS) {
      const balance = token.native
        ? await this.getCcnBalance(address)
        : await this.balanceOf(token.address, address);
      balances.push({ symbol: token.symbol, address: token.address, balance });
    }
    return balances;
  }

  private async balanceOf(tokenAddress: string, owner: string): Promise<string> {
    const data = `${BALANCE_OF_SELECTOR}${encodeAddressArg(owner)}`;
    const hex = await this.rpc<string>("eth_call", [
      { to: tokenAddress, data },
      "latest",
    ]);
    return formatWeiToEther(hex);
  }

  async getTransactionReceipt(updateId: string): Promise<CantonTransactionReceipt | null> {
    if (!isValidUpdateId(updateId)) {
      throw new AppError({
        statusCode: 400,
        code: "CANTON_INVALID_UPDATE_ID",
        message: "The Canton transfer must report a valid 0x update id.",
      });
    }
    const receipt = await this.rpc<CantonTransactionReceipt | null>(
      "eth_getTransactionReceipt",
      [updateId],
    );
    return receipt ?? null;
  }

  async hasConfirmedTransaction(updateId: string): Promise<boolean> {
    const receipt = await this.getTransactionReceipt(updateId);
    if (!receipt) return false;
    // Canton update ids are final as soon as they exist on the ledger. A
    // missing block number means the shim has not yet surfaced a settled round.
    return receipt.status !== "0x0" && !!receipt.blockNumber;
  }
}

let clientInstance: MetatarzRpcClient | null = null;

/** Creates the real Metatarz RPC client. No implicit mock fallback. */
export function getMetatarzRpcClient(): MetatarzRpcClient {
  if (clientInstance) return clientInstance;
  const env = getEnv();
  clientInstance = new OfficialMetatarzRpcClient(
    env.METATARZ_RPC_URL,
    env.METATARZ_CHAIN_ID,
    env.METATARZ_TIMEOUT_MS,
  );
  return clientInstance;
}

/** Dependency-injection hook for tests. */
export function setMetatarzRpcClientForTesting(client: MetatarzRpcClient | null): void {
  clientInstance = client;
}