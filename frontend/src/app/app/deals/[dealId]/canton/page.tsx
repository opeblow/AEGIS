"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Banknote, CircleDot, Coins, RefreshCcw, Send, XCircle } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { post, get } from "@/lib/api";
import { uuid, fmtHash } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardBody, KeyValues } from "@/components/ui/data";
import { Field, Input, Select } from "@/components/ui/inputs";
import { StatusChip } from "@/components/ui/badge";
import { Empty, Loading } from "@/components/ui/atoms";
import { useToast } from "@/components/ui/toast";
import { useCantonWallet } from "@/lib/canton/context";
import { CANTON_TOKENS } from "@/lib/canton/config";
import type { OneSwapPool, OneSwapQuote, OneSwapSwap, OneSwapToken } from "@/lib/types";

const TERMINAL_SWAP_STATUSES = new Set(["executed", "settled", "canceled", "expired"]);

function swapTone(status: string): "accent" | "amber" | "rose" | "neutral" | "success" {
  if (status === "executed" || status === "settled") return "success";
  if (status === "canceled" || status === "expired") return "neutral";
  if (status === "deposit_pending" || status === "quote_generated") return "amber";
  if (status === "deposit_detected" || status === "pending_execution") return "accent";
  return "neutral";
}

export default function DealCanton() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { push } = useToast();
  const wallet = useCantonWallet();

  const tokensApi = useApi<{ tokens: OneSwapToken[] }>(
    dealId ? `/deals/${dealId}/oneswap/tokens` : null,
  );
  const poolsApi = useApi<{ pools: OneSwapPool[] }>(
    dealId ? `/deals/${dealId}/oneswap/pools` : null,
  );

  const tokenOptions = useMemo(() => {
    const base = tokensApi.data?.tokens ?? [];
    const symbols = new Set<string>();
    const options: { value: string; label: string }[] = [];
    for (const t of base) {
      if (t.symbol && !symbols.has(t.symbol)) {
        symbols.add(t.symbol);
        options.push({ value: t.symbol, label: t.symbol });
      }
    }
    for (const t of CANTON_TOKENS) {
      if (!symbols.has(t.symbol)) {
        symbols.add(t.symbol);
        options.push({ value: t.symbol, label: t.symbol });
      }
    }
    return options;
  }, [tokensApi.data]);

  const poolOptions = useMemo(() => {
    const base = poolsApi.data?.pools ?? [];
    return base
      .map((p) => {
        const id = String(p.id ?? p.poolId ?? "");
        return {
          value: id,
          label: `${p.token0Symbol ?? p.inSymbol ?? "?"} / ${p.token1Symbol ?? p.outSymbol ?? "?"}`,
        };
      })
      .filter((p) => p.value);
  }, [poolsApi.data]);

  const [fromToken, setFromToken] = useState("CC");
  const [toToken, setToToken] = useState("USDCx");
  const [amount, setAmount] = useState("");
  const [poolId, setPoolId] = useState("");

  const [quote, setQuote] = useState<OneSwapQuote | null>(null);
  const [swap, setSwap] = useState<OneSwapSwap | null>(null);
  const [swapNote, setSwapNote] = useState<string | null>(null);
  const [pendingUpdateId, setPendingUpdateId] = useState<string | null>(null);
  const [funding, setFunding] = useState(false);
  const [busyQuote, setBusyQuote] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const [busyCancel, setBusyCancel] = useState(false);
  const [busyStatus, setBusyStatus] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getQuote = async () => {
    setBusyQuote(true);
    setError(null);
    try {
      const res = await post<{ quote: OneSwapQuote }>(`/deals/${dealId}/oneswap/quote`, {
        fromToken,
        toToken,
        fromAmount: amount,
        ...(poolId ? { poolId } : {}),
      });
      setQuote(res.quote);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Quote failed.");
    } finally {
      setBusyQuote(false);
    }
  };

  const createSwap = async () => {
    setBusyCreate(true);
    setError(null);
    try {
      const res = await post<{ swap: OneSwapSwap; note: string; replay: boolean }>(
        `/deals/${dealId}/oneswap/swap`,
        {
          idempotencyKey: uuid(),
          fromToken,
          toToken,
          fromAmount: amount,
          ...(poolId ? { poolId } : {}),
          slippageTolerance: 0.5,
        },
      );
      setSwap(res.swap);
      setSwapNote(res.note);
      setQuote(null);
      push({ kind: "success", title: `Swap ${res.swap.id ?? ""} created`, message: res.replay ? "Idempotent replay." : "Create a deposit by sending funds to depositParty." });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creating the swap failed.");
    } finally {
      setBusyCreate(false);
    }
  };

  const fundDeposit = async () => {
    if (!swap) return;
    const depositParty = swap.depositParty;
    if (!depositParty) {
      setError("This swap has no deposit party yet. Refresh its status.");
      return;
    }
    const token = CANTON_TOKENS.find((t) => t.symbol === swap.inSymbol);
    if (!token) {
      setError(`No Canton token configured for ${swap.inSymbol}.`);
      return;
    }
    setFunding(true);
    setError(null);
    try {
      const updateId = await wallet.sendTransfer({
        to: depositParty,
        amount: String(swap.amountIn ?? amount ?? "0"),
        token,
      });
      setPendingUpdateId(updateId);
      push({ kind: "success", title: "Deposit signed on Canton", message: `update ${fmtHash(updateId)}` });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The wallet transfer did not complete.");
    } finally {
      setFunding(false);
    }
  };

  const recordDeposit = async (updateId: string) => {
    setError(null);
    try {
      const res = await post<{ swap: OneSwapSwap; depositUpdateId: string; verified: boolean }>(
        `/deals/${dealId}/oneswap/swap/${swap?.id}/deposit`,
        { updateId, senderAddress: wallet.account ?? undefined },
      );
      setSwap(res.swap);
      setPendingUpdateId(null);
      push({ kind: "success", title: "Deposit recorded & verified on ledger" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Recording the deposit failed.");
    }
  };

  const cancelSwapOp = async () => {
    if (!swap?.id) return;
    setBusyCancel(true);
    setError(null);
    try {
      const res = await post<{ swap: OneSwapSwap }>(`/deals/${dealId}/oneswap/swap/${swap.id}/cancel`);
      setSwap(res.swap);
      push({ kind: "info", title: "Swap cancelled", message: res.swap.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancelling the swap failed.");
    } finally {
      setBusyCancel(false);
    }
  };

  const refreshStatus = async () => {
    if (!swap?.id) return;
    setBusyStatus(true);
    setError(null);
    try {
      const res = await get<{ status: OneSwapSwap }>(`/deals/${dealId}/oneswap/swap/${swap.id}`);
      setSwap(res.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refreshing swap status failed.");
    } finally {
      setBusyStatus(false);
    }
  };

  const swapActive = swap && !TERMINAL_SWAP_STATUSES.has(swap.status);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Wallet */}
        <Card>
          <CardHeader
            title="Canton wallet (Metatarz)"
            subtitle="Non-custodial external-party signing. The backend never holds a private key."
            icon={<CircleDot className="size-4 text-faint" />}
            right={
              wallet.connected ? (
                <Button size="sm" variant="ghost" onClick={wallet.disconnect}>
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon={<CircleDot className="size-3.5" />} loading={wallet.connecting} onClick={() => wallet.connect().catch(() => undefined)}>
                  Connect
                </Button>
              )
            }
          />
          <div className="border-t border-line p-4">
            {wallet.connected ? (
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip size="xs" label={`${wallet.name ?? "Metatarz"} · chain ${wallet.chainId ?? "?"}`} tone="success" dot />
                  <span className="mono text-xs text-faintest">{wallet.account}</span>
                </div>
                <KeyValues
                  values={wallet.balances.map((b) => [
                    b.symbol,
                    <span key={b.symbol} className="mono">{b.balance}</span>,
                  ])}
                />
              </div>
            ) : (
              <Empty
                title="Connect your Metatarz wallet"
                message="Required to fund swaps and pay settlement transfers. Ensure this site and your party addresses are whitelisted."
                icon={<CircleDot className="size-5" />}
              />
            )}
          </div>
        </Card>

        {/* Quote / swap creation */}
        <Card>
          <CardHeader
            title="OneSwap quote & swap"
            subtitle="Create a Canton swap intent, then fund its deposit party from your wallet."
            icon={<Coins className="size-4 text-faint" />}
          />
          <CardBody className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="From token">
                <Select options={tokenOptions} value={fromToken} onChange={(e) => setFromToken(e.target.value)} />
              </Field>
              <Field label="To token">
                <Select options={tokenOptions} value={toToken} onChange={(e) => setToToken(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount">
                <Input inputMode="decimal" placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field label="Pool (optional)">
                <Select options={poolOptions} placeholder="Auto" value={poolId} onChange={(e) => setPoolId(e.target.value)} />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" loading={busyQuote} disabled={!amount} onClick={getQuote}>
                Get quote
              </Button>
              <Button size="sm" loading={busyCreate} disabled={!amount || !wallet.connected} onClick={createSwap}>
                Create swap
              </Button>
              <p className="text-[11px] text-faintest">Minimum out · 0.5% slippage</p>
            </div>
            {quote && (
              <div className="rounded-xl border border-line bg-ink-925 p-3 text-sm">
                <KeyValues
                  values={[
                    ["Rate", `${quote.inSymbol ?? fromToken} → ${quote.outSymbol ?? toToken}`],
                    ["Output", quote.toAmount ?? "—"],
                    ["Output (net)", quote.toAmountWithoutFee ?? "—"],
                    ["Fee", quote.fee ? String(quote.fee) : "—"],
                    ["Price impact", quote.priceImpact ? `${quote.priceImpact}%` : "—"],
                  ]}
                />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Active swap */}
      {swap && (
        <Card>
          <CardHeader
            title={`Swap ${swap.id ?? swap.swapId ?? ""}`}
            subtitle={swapNote ?? undefined}
            icon={<Banknote className="size-4 text-faint" />}
            right={<StatusChip size="xs" label={swap.status} tone={swapTone(swap.status)} dot />}
          />
          <CardBody className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KeyValues
                values={[
                  ["Pair", `${swap.inSymbol ?? "?"} → ${swap.outSymbol ?? "?"}`],
                  ["Amount in", swap.amountIn != null ? String(swap.amountIn) : "—"],
                  ["Min out", swap.minOut != null ? String(swap.minOut) : "—"],
                  ["Type", swap.poolType ?? "—"],
                ]}
              />
            </div>

            <div className="rounded-xl border border-line bg-ink-925 p-3 text-sm">
              <p className="eyebrow">Deposit party</p>
              <p className="mt-1 mono text-xs break-all text-muted">{swap.depositParty ?? "—"}</p>
              <p className="mt-2 text-[11px] text-faintest">
                Whitelist this party address in Metatarz, then fund the deposit below. OneSwap detects the deposit on-chain.
              </p>
            </div>

            {swapActive && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  icon={<Send className="size-4" />}
                  loading={funding}
                  disabled={!wallet.connected || !swap.depositParty}
                  onClick={fundDeposit}
                >
                  Fund deposit via Metatarz
                </Button>
                {pendingUpdateId && (
                  <Button size="sm" variant="success" onClick={() => recordDeposit(pendingUpdateId)}>
                    Record & verify deposit ({fmtHash(pendingUpdateId)})
                  </Button>
                )}
                <Button size="sm" variant="secondary" icon={<RefreshCcw className="size-4" />} loading={busyStatus} onClick={refreshStatus}>
                  Refresh status
                </Button>
                <Button size="sm" variant="danger" icon={<XCircle className="size-4" />} loading={busyCancel} onClick={cancelSwapOp}>
                  Cancel
                </Button>
              </div>
            )}
            {!swapActive && (
              <p className="text-sm text-faintest">Terminal: {swap.status}. No further wallet action needed.</p>
            )}
            {!swapActive && swap.txId && (
              <p className="mono text-xs text-faintest">execution update: {swap.txId}</p>
            )}
          </CardBody>
        </Card>
      )}

      {/* Pools + tickers */}
      <Card>
        <CardHeader
          title="OneSwap pools"
          subtitle="Live market data from the Canton DEX."
          icon={<Banknote className="size-4 text-faint" />}
        />
        <div className="border-t border-line" />
        {poolsApi.loading ? (
          <Loading rows={4} className="p-4" />
        ) : poolOptions.length === 0 ? (
          <div className="p-4"><Empty title="No pools exposed" message="The SDK pool list returned no pools on this network." icon={<Banknote className="size-5" />} /></div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {poolOptions.slice(0, 12).map((p) => (
              <PoolTickerRow key={p.value} dealId={dealId} poolId={p.value} label={p.label} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function PoolTickerRow({
  dealId,
  poolId,
  label,
}: {
  dealId: string;
  poolId: string;
  label: string;
}) {
  const [ticker, setTicker] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await get<{ ticker: Record<string, unknown> }>(`/deals/${dealId}/oneswap/pool/${poolId}/ticker`);
      setTicker(res.ticker);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-ink-925 px-3 py-2.5">
      <span className="mono text-xs text-paper">{label}</span>
      <span className="text-xs text-muted">{poolId.slice(0, 18)}…</span>
      <span className="ml-auto text-xs text-faintest">
        {loading
          ? "loading…"
          : failed
            ? "ticker unavailable"
            : ticker
              ? formatTicker(ticker)
              : "not fetched"}
      </span>
      <Button size="sm" variant="ghost" icon={<RefreshCcw className="size-3.5" />} loading={loading} onClick={load}>
        Ticker
      </Button>
    </div>
  );
}

function formatTicker(t: Record<string, unknown>): string {
  const price = t.lastPrice ?? t.price ?? t.bidPrice;
  const pct = t.priceChangePercent24 ?? t.changePercent24;
  const parts: string[] = [];
  if (typeof price === "number" || typeof price === "string") parts.push(String(price));
  if (typeof pct === "number" || typeof pct === "string") parts.push(`${pct}%`);
  if (t.volume24) parts.push(`vol ${String(t.volume24)}`);
  return parts.join(" · ") || "ok";
}