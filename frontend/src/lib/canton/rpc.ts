"use client";

/**
 * Dependency-free JSON-RPC client for the Metatarz Canton EVM shim.
 * Used for read-only balance queries; signing happens in the browser wallet.
 */

import {
  CANTON_RPC_URL,
  CANTON_TOKENS,
  balanceOfCall,
  formatWeiToEther,
  type CantonTokenBalance,
} from "./config";

const REQUEST_TIMEOUT_MS = 15000;

async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(CANTON_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Canton RPC responded with HTTP ${res.status}.`);
    const payload = (await res.json()) as {
      result?: unknown;
      error?: { message?: string };
    };
    if (payload.error) throw new Error(payload.error.message ?? "Canton RPC error.");
    return payload.result as T;
  } finally {
    window.clearTimeout(timer);
  }
}

async function getBalance(address: string, tokenAddress: string, native: boolean): Promise<string> {
  if (native) return formatWeiToEther(await rpc<string>("eth_getBalance", [address, "latest"]));
  const call = balanceOfCall(tokenAddress, address);
  return formatWeiToEther(await rpc<string>("eth_call", [call, "latest"]));
}

/** Reads CC + CIP-56 balances straight from the public Metatarz shim. */
export async function getCantonBalances(address: string): Promise<CantonTokenBalance[]> {
  const balances: CantonTokenBalance[] = [];
  for (const token of CANTON_TOKENS) {
    try {
      balances.push({
        symbol: token.symbol,
        address: token.address,
        balance: await getBalance(address, token.address, token.native),
      });
    } catch {
      balances.push({ symbol: token.symbol, address: token.address, balance: "0" });
    }
  }
  return balances;
}

export async function getCcnBalance(address: string): Promise<string> {
  return getBalance(address, CANTON_TOKENS[0].address, true);
}