"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Landmark, RefreshCcw, Send, ShieldCheck, WalletCards } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate, fmtMoney, fmtHash, timeAgo, uuid } from "@/lib/format";
import { humanLabel, toneFor } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KeyValues } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Empty, Loading } from "@/components/ui/atoms";
import { Field, Input, Select } from "@/components/ui/inputs";
import { useToast } from "@/components/ui/toast";
import { useCantonWallet } from "@/lib/canton/context";
import { CANTON_TOKENS } from "@/lib/canton/config";
import type { PublicSettlement, PublicReconciliation } from "@/lib/types";

export default function DealSettlement() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { push } = useToast();
  const wallet = useCantonWallet();

  const settlementApi = useApi<{ settlements: PublicSettlement[]; total: number }>(
    dealId ? `/deals/${dealId}/settlement` : null,
  );
  const reconApi = useApi<{ reconciliations: PublicReconciliation[]; total: number }>(
    dealId ? `/deals/${dealId}/reconciliation` : null,
  );

  const settlements = settlementApi.data?.settlements ?? [];
  const recons = reconApi.data?.reconciliations ?? [];

  const [initiating, setInitiating] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initiate = async () => {
    setInitiating(true);
    setError(null);
    try {
      const res = await post<{ settlement: PublicSettlement }>(`/deals/${dealId}/settlement`, {
        idempotencyKey: uuid(),
      });
      push({ kind: "success", title: "Settlement initiated", message: `${res.settlement.provider}` });
      settlementApi.reload();
      reconApi.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to initiate settlement.");
    } finally {
      setInitiating(false);
    }
  };

  const submit = async (s: PublicSettlement, body: { updateId?: string; senderAddress?: string }) => {
    setSubmittingId(s.id);
    setError(null);
    try {
      await post(`/deals/${dealId}/settlement/${s.id}/submit`, body);
      push({ kind: "success", title: "Submitted to provider", message: s.provider });
      settlementApi.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provider submit failed.");
    } finally {
      setSubmittingId(null);
    }
  };

  const reconcile = async (s: PublicSettlement) => {
    setError(null);
    try {
      await post(`/deals/${dealId}/settlement/${s.id}/reconcile`, { requestId: uuid() });
      push({ kind: "success", title: "Reconciliation requested" });
      reconApi.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconciliation failed.");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>
      )}

      <div className="flex items-center justify-between">
        <CardHeader
          title="Settlement"
          subtitle="Verified provider state. Watch channels are only shown after the provider confirms."
          icon={<Landmark className="size-4 text-faint" />}
        />
        <Button
          size="sm"
          icon={<Send className="size-4" />}
          loading={initiating}
          onClick={initiate}
        >
          Initiate settlement
        </Button>
      </div>

      {settlementApi.loading ? (
        <Loading rows={6} />
      ) : settlements.length === 0 ? (
        <Empty
          title="No settlement initiated"
          message="Initiate payment to the counterparty through the clearing provider."
          icon={<Landmark className="size-5" />}
          action={
            <Button size="sm" icon={<Send className="size-4" />} loading={initiating} onClick={initiate}>
              Initiate
            </Button>
          }
        />
      ) : (
        settlements.map((s) => (
          <Card key={s.id}>
            <CardHeader
              title={`${s.provider} settlement`}
              subtitle={s.providerReference ? `Provider ref ${s.providerReference}` : undefined}
              icon={<ShieldCheck className="size-4 text-faint" />}
              right={
                <StatusChip label={humanLabel(s.status)} tone={toneFor.settlement(s.status)} dot />
              }
            />
            <div className="grid grid-cols-2 gap-4 border-t border-line p-4 lg:grid-cols-4">
              <KeyValues
                values={[
                  ["Amount", fmtMoney(s.amount, s.currency)],
                  ["Initiated", fmtDate(s.initiatedAt)],
                  ["Submitted", s.submittedAt ? fmtDate(s.submittedAt) : "—"],
                  ["Completed", s.completedAt ? fmtDate(s.completedAt) : "—"],
                ]}
              />
            </div>
            <div className="border-t border-line p-4 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {["CREATED", "PENDING"].includes(s.status) &&
                  (s.provider === "CANTON" ? (
                    <CantonPayActions
                      settlement={s}
                      walletConnected={wallet.connected}
                      onPay={(updateId, senderAddress) => submit(s, { updateId, senderAddress })}
                      onError={(message) => setError(message)}
                      onInfo={(m) => push({ kind: "success", title: "Canton transfer signed", message: m })}
                    />
                  ) : (
                    <Button size="sm" variant="secondary" loading={submittingId === s.id} onClick={() => submit(s, {})}>
                      Submit to provider
                    </Button>
                  ))}
                {toneFor.settlement(s.status) !== "neutral" && ["SETTLED", "PENDING"].includes(s.status) && (
                  <Button size="sm" variant="ghost" icon={<RefreshCcw className="size-4" />} onClick={() => reconcile(s)}>
                    Reconcile
                  </Button>
                )}
                <p className="ml-auto text-[11px] text-faintest">Updated {timeAgo(s.updatedAt)}</p>
              </div>
            </div>
          </Card>
        ))
      )}

      <Card>
        <CardHeader title="Reconciliation" subtitle="Provider-side cross-check of settled state" icon={<RefreshCcw className="size-4 text-faint" />} />
        <div className="border-t border-line" />
        {reconApi.loading ? (
          <Loading rows={3} className="p-4" />
        ) : recons.length === 0 ? (
          <div className="p-4"><Empty title="Nothing to reconcile yet" message="Settlements that have been submitted will surface here." icon={<RefreshCcw className="size-5" />} /></div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {recons.map((r) => (
              <div key={r.id} className="rounded-xl border border-line bg-ink-925 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-paper">{humanLabel(r.status)}</span>
                  <StatusChip size="xs" label={humanLabel(r.status)} tone={toneFor.reconciliation(r.status)} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <p className="text-faintest">Expected <span className="mono text-muted">{fmtMoney(r.expectedAmount, r.expectedCurrency)}</span></p>
                  <p className="text-faintest">Actual {r.actualAmount ? <span className="mono text-muted">{fmtMoney(r.actualAmount, r.actualCurrency ?? r.expectedCurrency)}</span> : <span className="text-faintest">—</span>}</p>
                </div>
                {r.mismatchReason && (
                  <p className="mt-2 rounded-lg border border-amber/25 bg-amber-soft px-3 py-2 text-xs text-amber">{r.mismatchReason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/**
 * Canton (Metatarz) settlement payment: the user executes the CC/CIP-56
 * transfer in their own non-custodial wallet, then submits the returned
 * update id so the backend verifies and settles against the ledger.
 */
function CantonPayActions({
  settlement,
  walletConnected,
  onPay,
  onError,
  onInfo,
}: {
  settlement: PublicSettlement;
  walletConnected: boolean;
  onPay: (updateId: string, senderAddress?: string) => Promise<void>;
  onError: (message: string) => void;
  onInfo: (message: string) => void;
}) {
  const wallet = useCantonWallet();
  const [to, setTo] = useState("");
  const [token, setToken] = useState(settlement.assetIdentifier ?? "CC");
  const [payAmount, setPayAmount] = useState(settlement.amount);
  const [paying, setPaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [updateId, setUpdateId] = useState<string | null>(null);

  const tokenOptions = CANTON_TOKENS.map((t) => ({ value: t.symbol, label: t.symbol }));

  const execute = async () => {
    if (!wallet.connected) {
      onError("Connect the Metatarz wallet before paying.");
      return;
    }
    const found = CANTON_TOKENS.find((t) => t.symbol === token);
    if (!to) {
      onError("Enter the recipient party (counterparty) address.");
      return;
    }
    setPaying(true);
    try {
      const update = await wallet.sendTransfer({ to, amount: payAmount, token: found ?? CANTON_TOKENS[0] });
      setUpdateId(update);
      onInfo(fmtHash(update));
    } catch (e) {
      onError(e instanceof Error ? e.message : "The wallet transfer did not complete.");
    } finally {
      setPaying(false);
    }
  };

  const submitSigned = async () => {
    if (!updateId) return;
    setSubmitting(true);
    try {
      await onPay(updateId, wallet.account ?? undefined);
      setUpdateId(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-3 rounded-xl border border-line bg-ink-925 p-3">
      {!wallet.connected && (
        <Button size="sm" variant="secondary" icon={<WalletCards className="size-4" />} loading={wallet.connecting} onClick={() => wallet.connect().catch(() => undefined)}>
          Connect Metatarz wallet first
        </Button>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Field label="Token">
          <Select options={tokenOptions} value={token} onChange={(e) => setToken(e.target.value)} />
        </Field>
        <Field label="Amount">
          <Input inputMode="decimal" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
        </Field>
        <div className="col-span-2 lg:col-span-1">
          <Field label="Recipient (Canton party)" hint={settlement.currency === "CC" ? `${settlement.amount} ${settlement.currency} expected` : undefined}>
            <Input mono placeholder="0x… or Canton::…" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
      </div>
      {updateId ? (
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip size="xs" label={`update ${fmtHash(updateId)}`} tone="accent" dot />
          <Button size="sm" variant="success" icon={<Send className="size-4" />} loading={submitting} onClick={submitSigned}>
            Submit & verify on ledger
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setUpdateId(null)}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="sm" icon={<Send className="size-4" />} loading={paying} disabled={!walletConnected} onClick={execute}>
            Execute transfer
          </Button>
          <p className="text-[11px] text-faintest">Signs in Metatarz · returns a Canton update id</p>
        </div>
      )}
    </div>
  );
}