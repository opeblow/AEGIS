"use client";

import { useState } from "react";
import { PlugZap, Unplug, Wallet } from "lucide-react";
import { useCantonWallet, useCantonTokenBalance } from "@/lib/canton/context";
import { CANTON_CHAIN_NAME, shortAddress } from "@/lib/canton/config";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export function CantonWalletChip() {
  const { connected, account, name, chainId, connecting, error, connect, disconnect } = useCantonWallet();
  const cc = useCantonTokenBalance("CC");
  const { push } = useToast();
  const [busy, setBusy] = useState(false);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connect();
      push({ kind: "success", title: "Canton wallet connected" });
    } catch {
      // error surfaces via context; toast would duplicate it
    } finally {
      setBusy(false);
    }
  };

  if (!connected) {
    return (
      <Button
        size="sm"
        variant="secondary"
        icon={<PlugZap className="size-3.5" />}
        loading={connecting || busy}
        onClick={onConnect}
        aria-label="Connect Canton wallet"
      >
        <span className="hidden sm:inline">Canton wallet</span>
      </Button>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-ink-925 px-2 py-1">
      <Wallet className="size-3.5 shrink-0 text-accent" />
      <span className="hidden text-xs text-muted md:inline">{name ?? "Metatarz"}</span>
      {cc !== "0" && (
        <span className="mono hidden min-w-0 truncate text-xs text-paper lg:inline" title={`CC balance`}>
          {cc} CC
        </span>
      )}
      <span className="mono min-w-0 truncate text-xs text-faintest" title={chainId ? `${CANTON_CHAIN_NAME} · chain ${chainId}` : CANTON_CHAIN_NAME}>
        {account ? shortAddress(account) : "…"}
      </span>
      <button
        onClick={() => {
          disconnect();
          push({ kind: "info", title: "Canton wallet disconnected" });
        }}
        className="focus-ring -mr-0.5 shrink-0 rounded p-2 text-faint hover:text-rose"
        aria-label="Disconnect Canton wallet"
        title="Disconnect"
      >
        <Unplug className="size-3.5" />
      </button>
      {error && <span className="sr-only">{error}</span>}
    </div>
  );
}