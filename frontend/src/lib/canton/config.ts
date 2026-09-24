"use client";

/**
 * Canton (Metatarz) client configuration. Mirrors the backend's
 * Metatarz EVM shim constants (backend/src/modules/settlement/canton/metatarz).
 *
 * Metatarz is non-custodial: the backend never sees a private key. The
 * wallet (EIP-1193 + EIP-6963) signs CC / CIP-56 transfers and returns a
 * Canton-ledger `update_id` per transfer; the backend verifies it via RPC.
 */

export const CANTON_CHAIN_ID = 30337;
export const CANTON_CHAIN_NAME = "Canton (Metatarz)";
export const CANTON_DECIMALS = 18;

export const CANTON_RPC_URL =
  process.env.NEXT_PUBLIC_METATARZ_RPC_URL ??
  "https://canton-testnet.rpc.wallet.metatarz.xyz";

export interface CantonToken {
  symbol: string;
  address: string;
  native: boolean;
  name: string;
}

export const CANTON_TOKENS: readonly CantonToken[] = [
  { symbol: "CC", address: "0x0000000000000000000000000000000000000000", native: true, name: "Canton Coin" },
  { symbol: "USDCx", address: "0xDE40000000000000000000000000000000000001", native: false, name: "Canton Circle USD" },
  { symbol: "HANDL", address: "0xDE50000000000000000000000000000000000001", native: false, name: "HANDL" },
  { symbol: "CBTC", address: "0xDE60000000000000000000000000000000000001", native: false, name: "Canton Bitcoin" },
  { symbol: "cETH", address: "0xDE70000000000000000000000000000000000001", native: false, name: "Canton Ether" },
];

export function cantonTokenBySymbol(symbol: string): CantonToken | undefined {
  return CANTON_TOKENS.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}

const BALANCE_OF_SELECTOR = "0x70a08231";

/** 32-byte left-padded hex for an EVM address argument. */
function encodeAddressArg(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** Hex wei string → decimal string with 18 decimals (no precision loss). */
export function formatWeiToEther(hexWei: string): string {
  const value = BigInt(hexWei);
  const whole = value / BigInt(10) ** BigInt(CANTON_DECIMALS);
  const fraction = value % BigInt(10) ** BigInt(CANTON_DECIMALS);
  const frac = fraction.toString().padStart(CANTON_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Decimal string (18 decimals) → hex wei for eth_sendTransaction. */
export function etherToWeiHex(amount: string): string {
  const decimals = BigInt(CANTON_DECIMALS);
  const [whole = "0", frac = ""] = amount.trim().split(".");
  if (frac.length > CANTON_DECIMALS) {
    throw new Error(`Amount exceeds ${CANTON_DECIMALS} decimal places.`);
  }
  const value = BigInt(whole) * BigInt(10) ** decimals + BigInt(frac.padEnd(CANTON_DECIMALS, "0") || "0");
  return `0x${value.toString(16)}`;
}

export function shortAddress(address: string, chars = 6): string {
  return address.length <= chars * 2 + 2 ? address : `${address.slice(0, chars)}…${address.slice(-4)}`;
}

export interface CantonTokenBalance {
  symbol: string;
  address: string;
  balance: string;
}

export function balanceOfCall(tokenAddress: string, owner: string): { to: string; data: string } {
  return { to: tokenAddress, data: `${BALANCE_OF_SELECTOR}${encodeAddressArg(owner)}` };
}