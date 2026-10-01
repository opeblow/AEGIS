"use client";

/**
 * Minimal EIP-1193 / EIP-6963 provider adapter used to detect and drive the
 * Metatarz wallet (which is MetaMask-compatible: `wallet_connector: metaminer`,
 * CIP-0103, non-custodial external-party signing with return value = update id).
 *
 * No wallet library is installed — this is a dependency-free wrapper.

 * Signing flow: `eth_sendTransaction` is intercepted by the wallet into
 * prepare → sign → execute, and resolves with the Canton `update_id`
 * (the returned tx hash). The backend can then verify it via
 * `eth_getTransactionReceipt` against the public Metatarz shim.
 */

import { CANTON_CHAIN_ID, etherToWeiHex, type CantonToken } from "./config";

export interface Eip1193RequestFn {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
}

export interface WalletProvider {
  name: string;
  uuid: string;
  icon?: string;
  request: Eip1193RequestFn["request"];
}

export interface ProviderEventHandlers {
  onAccountsChanged?: (accounts: string[]) => void;
  onChainChanged?: (chainIdHex: string) => void;
}

interface AnnounceEvent extends Event {
  detail: { info: { name: string; uuid: string; icon?: string }; provider: Eip1193RequestFn };
}

export class CantonWalletError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "CantonWalletError";
  }
}

const WAIT_MS = 2500;

/** Wait for an EIP-6963 announcement; fall back to window.ethereum (MetaMask). */
export async function detectMetatarzWallet(timeoutMs = WAIT_MS): Promise<WalletProvider> {
  const provider = await new Promise<WalletProvider | null>((resolve) => {
    let settled = false;
    const finish = (p: WalletProvider | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(p);
    };
    const onAnnounce = (event: Event) => {
      const detail = (event as AnnounceEvent).detail;
      if (!detail?.provider || !detail?.info) return;
      const name = String(detail.info.name ?? "").toLowerCase();
      // Prefer the Metatarz wallet connector; fall back to any EIP-6963 provider.
      if (name.includes("metatarz") || name.includes("meta") || name.includes("miner")) {
        finish({
          name: detail.info.name,
          uuid: detail.info.uuid,
          icon: detail.info.icon,
          request: detail.provider.request.bind(detail.provider),
        });
      }
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:announceProvider"));
  });

  if (provider) return provider;

  const eth = (window as unknown as { ethereum?: Eip1193RequestFn }).ethereum;
  if (eth && typeof eth.request === "function") {
    return { name: "MetaMask", uuid: "window.ethereum", request: eth.request.bind(eth) };
  }

  // Demo mode: no extension installed. Return an in-page stand-in so the flow
  // can be demonstrated on a machine with no wallet. Gated on an explicit
  // build-time flag and clearly surfaced in the UI as a demo session.
  if (DEMO_MODE) {
    return {
      name: "Metatarz (demo)",
      uuid: "aegis-demo-wallet",
      request: demoRequest,
    };
  }

  throw new CantonWalletError(
    "No Metatarz or MetaMask wallet detected. Install the Metatarz extension and whitelist this site (and your party addresses in Canton) before proceeding.",
    "CANTON_WALLET_MISSING",
  );
}

export const DEMO_MODE =
  process.env.NEXT_PUBLIC_DEMO_MODE === "true";

const DEMO_ACCOUNT = "0x9A7c3F1e5bB24d0A6c8E1f4B2d7095A3c8E6f1B42";

/**
 * In-page EIP-1193 stand-in used only in demo mode. It fabricates a plausible
 * Canton `update_id` so the backend's verification path can be exercised
 * without a real ledger. Never reached when a wallet extension is installed.
 */
async function demoRequest(args: { method: string; params?: unknown[] }): Promise<unknown> {
  switch (args.method) {
    case "eth_requestAccounts":
    case "eth_accounts":
      return [DEMO_ACCOUNT];
    case "eth_chainId":
      return `0x${CANTON_CHAIN_ID.toString(16)}`;
    case "eth_getBalance":
      return "0x1bc16d674ec80000"; // 2 CC
    case "eth_call":
      return "0x0000000000000000000000000000000000000000000000000000000005f5e100";
    case "eth_getTransactionReceipt":
      return {
        status: "0x1",
        blockNumber: "0x1",
        transactionHash: (args.params?.[0] as string) ?? "0x0",
      };
    case "eth_sendTransaction":
      return fakeUpdateId();
    default:
      throw new CantonWalletError(
        `Demo wallet does not implement ${args.method}.`,
        "DEMO_WALLET_UNSUPPORTED",
      );
  }
}

/** Fabricates a 32-byte hex update id shaped like a Canton ledger update. */
function fakeUpdateId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface SendTransferOptions {
  to: string;
  amount: string;
  token: CantonToken;
  from?: string;
}

/**
 * Executes a Canton transfer in the wallet. CC is a native value transfer;
 * CIP-56 tokens are sent as token payloads the wallet shim understands.
 * Resolves with the Canton `update_id` when the transfer is signed + executed.
 */
export async function sendCantonTransfer(
  provider: WalletProvider,
  requestAccount: string,
  opts: SendTransferOptions,
): Promise<string> {
  const { to, amount, token, from = requestAccount } = opts;
  const isEipAddress = /^0x[0-9a-fA-F]{40}$/.test(to);
  // OneSwap deposit parties are Canton party references ("Canton::…"); the
  // Metatarz shim translates those into the external-party payment the
  // counterparty funds from.
  const isCantonParty = /^Canton::/.test(to);
  if (!isEipAddress && !isCantonParty) {
    throw new CantonWalletError(
      "Destination must be a 0x EVM address or a Canton:: party reference.",
      "CANTON_INVALID_TO",
    );
  }
  const params: Record<string, unknown> = {
    from,
    to: token.native ? to : to,
    value: token.native ? etherToWeiHex(amount) : "0x0",
  };
  if (!token.native) params.token = token.address;

  const hash = await provider.request({
    method: "eth_sendTransaction",
    params: [params],
  });
  const updateId = Array.isArray(hash) ? String(hash[0]) : String(hash);
  if (!/^0x[0-9a-fA-F]+$/.test(updateId)) {
    throw new CantonWalletError(
      "The wallet did not return a Canton update id. Reject the transfer if you did not approve it.",
      "CANTON_BAD_UPDATE_ID",
    );
  }
  return updateId;
}

const isHexChainId = (v: unknown): v is string => typeof v === "string" && /^0x[0-9a-f]+$/i.test(v);

export async function connectWallet(provider: WalletProvider): Promise<{
  account: string;
  chainId: number;
}> {
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
    params: [],
  })) as string[];
  const account = Array.isArray(accounts) ? accounts[0] : undefined;
  if (!account) {
    throw new CantonWalletError("Canton wallet returned no accounts. Whitelist this site in Metatarz.", "CANTON_NO_ACCOUNT");
  }

  let chainId = CANTON_CHAIN_ID;
  const rawChain = await provider.request({ method: "eth_chainId", params: [] });
  if (isHexChainId(rawChain)) chainId = Number.parseInt(rawChain, 16);

  return { account, chainId };
}

/** Subscribe to account/chain changes; returns an unsubscribe fn. */
export function watchWallet(
  provider: WalletProvider,
  handlers: ProviderEventHandlers,
): () => void {
  const providerAny = provider as unknown as {
    on?: (event: string, handler: (data: unknown) => void) => unknown;
    removeListener?: (event: string, handler: (data: unknown) => void) => unknown;
  };
  if (!providerAny.on) return () => undefined;

  const onAccounts = (accounts: unknown) => {
    if (Array.isArray(accounts)) handlers.onAccountsChanged?.(accounts.map(String));
  };
  const onChain = (chain: unknown) => {
    if (typeof chain === "string") handlers.onChainChanged?.(chain);
  };
  providerAny.on("accountsChanged", onAccounts);
  providerAny.on("chainChanged", onChain);
  return () => {
    providerAny.removeListener?.("accountsChanged", onAccounts);
    providerAny.removeListener?.("chainChanged", onChain);
  };
}