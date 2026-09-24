"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  connectWallet,
  detectMetatarzWallet,
  sendCantonTransfer,
  watchWallet,
  type WalletProvider,
} from "./wallet";
import { getCantonBalances } from "./rpc";
import { type CantonToken, type CantonTokenBalance } from "./config";

interface CantonWalletState {
  connected: boolean;
  connecting: boolean;
  provider: WalletProvider | null;
  account: string | null;
  name: string | null;
  chainId: number | null;
  balances: CantonTokenBalance[];
  error: string | null;
  connect: () => Promise<string>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  /** Executes a Canton transfer; resolves with the ledger update id. */
  sendTransfer: (opts: { to: string; amount: string; token: CantonToken }) => Promise<string>;
}

const CantonWalletContext = createContext<CantonWalletState | null>(null);

export function CantonWalletProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<WalletProvider | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<CantonTokenBalance[]>([]);

  const refreshBalances = useCallback(async () => {
    if (!account) return;
    try {
      setBalances(await getCantonBalances(account));
    } catch {
      setBalances([]);
    }
  }, [account]);

  const connect = useCallback(async (): Promise<string> => {
    setConnecting(true);
    setError(null);
    try {
      const detected = await detectMetatarzWallet();
      setProvider(detected);
      setName(detected.name);
      const { account: acc, chainId: cid } = await connectWallet(detected);
      setAccount(acc);
      setChainId(cid);
      setBalances(await getCantonBalances(acc));

      const unsubscribe = watchWallet(detected, {
        onAccountsChanged: (accounts) => {
          const next = accounts[0] ?? null;
          setAccount(next);
          if (next) void getCantonBalances(next).then(setBalances);
          else setBalances([]);
        },
        onChainChanged: (hex) => setChainId(Number.parseInt(hex, 16)),
      });
      // Provider instances are stable per connect; fine-grained cleanup
      // happens on disconnect/reconnect.
      void unsubscribe;
      return acc;
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not connect the Canton wallet.";
      setError(message);
      throw e;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setProvider(null);
    setAccount(null);
    setName(null);
    setChainId(null);
    setBalances([]);
    setError(null);
  }, []);

  const sendTransfer = useCallback(
    async (opts: { to: string; amount: string; token: CantonToken }): Promise<string> => {
      if (!provider || !account) {
        throw new Error("Connect the Metatarz wallet before transferring.");
      }
      const updateId = await sendCantonTransfer(provider, account, opts);
      await refreshBalances();
      return updateId;
    },
    [provider, account, refreshBalances],
  );

  useEffect(() => {
    if (!account) return;
    let alive = true;
    getCantonBalances(account).then(
      (result) => {
        if (alive) setBalances(result);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [account]);

  const value = useMemo<CantonWalletState>(
    () => ({
      connected: !!provider && !!account,
      connecting,
      provider,
      account,
      name,
      chainId,
      balances,
      error,
      connect,
      disconnect,
      refreshBalances,
      sendTransfer,
    }),
    [provider, account, name, chainId, balances, connecting, error, connect, disconnect, refreshBalances, sendTransfer],
  );

  return <CantonWalletContext.Provider value={value}>{children}</CantonWalletContext.Provider>;
}

export function useCantonWallet(): CantonWalletState {
  const ctx = useContext(CantonWalletContext);
  if (!ctx) throw new Error("useCantonWallet must be used within CantonWalletProvider.");
  return ctx;
}

/** Convenience: the balance of a single token symbol, or "0". */
export function useCantonTokenBalance(symbol: string): string {
  const { balances, connected } = useCantonWallet();
  if (!connected) return "0";
  return balances.find((b) => b.symbol === symbol)?.balance ?? "0";
}