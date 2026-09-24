"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Calendar, Gavel, Layers3, ListChecks } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate, fmtMoney, timeAgo } from "@/lib/format";
import { dealTypeLabel, humanLabel, toneFor } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KeyValues, Stat } from "@/components/ui/data";
import { StatusChip, Progress } from "@/components/ui/badge";
import { Modal } from "@/components/ui/overlay";
import { Field, Select, Textarea } from "@/components/ui/inputs";
import { useToast } from "@/components/ui/toast";
import { Loading, ErrorState } from "@/components/ui/atoms";
import type {
  PublicDeal,
  PublicDealTransition,
  PublicReadiness,
  ApprovalWorkflow,
} from "@/lib/types";
import { uuid } from "@/lib/format";

export default function DealOverview() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { activeOrg } = useSession();
  const { push } = useToast();
  const orgId = activeOrg?.organizationId ?? "";

  const dealApi = useApi<{ deal: PublicDeal }>(
    orgId && dealId ? `/organizations/${orgId}/deals/${dealId}` : null,
  );
  const historyApi = useApi<{ transitions: PublicDealTransition[] }>(
    orgId && dealId ? `/organizations/${orgId}/deals/${dealId}/history` : null,
  );
  const readinessApi = useApi<{ readiness: PublicReadiness }>(
    dealId ? `/deals/${dealId}/readiness` : null,
  );
  const workflowsApi = useApi<{ workflows: ApprovalWorkflow[] }>(
    orgId && dealId ? `/organizations/${orgId}/deals/${dealId}/approval-workflows` : null,
  );

  const deal = dealApi.data?.deal;
  const transitions = historyApi.data?.transitions ?? [];
  const readiness = readinessApi.data?.readiness;
  const workflows = workflowsApi.data?.workflows ?? [];

  const transitionableStatuses: Record<string, string[]> = {
    DRAFT: ["OPEN", "EXPIRED", "CANCELLED"],
    OPEN: ["NEGOTIATING", "EXPIRED", "CANCELLED"],
    NEGOTIATING: ["AGREED", "EXPIRED", "CANCELLED"],
    AGREED: ["APPROVAL_PENDING", "EXPIRED", "CANCELLED"],
    APPROVAL_PENDING: ["APPROVED", "CANCELLED", "FAILED"],
    APPROVED: ["SETTLEMENT_PENDING", "CANCELLED", "EXPIRED"],
    SETTLEMENT_PENDING: ["SETTLED", "FAILED", "CANCELLED"],
    SETTLED: ["RECONCILING", "DISPUTED"],
    RECONCILING: ["COMPLETED", "DISPUTED"],
    DISPUTED: ["RECONCILING", "CANCELLED"],
  };
  const canTransition =
    deal && orgId && !["COMPLETED", "EXPIRED", "CANCELLED", "FAILED"].includes(deal.status);

  const [transitionOpen, setTransitionOpen] = useState(false);
  const [toStatus, setToStatus] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitTransition = async () => {
    if (!deal || !orgId || !toStatus) return;
    setBusy(true);
    setError(null);
    try {
      await post<{ deal: PublicDeal }>(`/organizations/${orgId}/deals/${dealId}/transitions`, {
        toStatus,
        reason: reason || undefined,
        version: deal.version,
        requestId: uuid(),
      });
      push({ kind: "success", title: "Transition submitted", message: `Moving to ${humanLabel(toStatus)}` });
      setTransitionOpen(false);
      setToStatus("");
      setReason("");
      dealApi.reload();
      historyApi.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transition failed.");
    } finally {
      setBusy(false);
    }
  };

  if (dealApi.loading) return <Loading rows={8} />;
  if (dealApi.error || !deal) return <ErrorState message={dealApi.error ?? "Deal not found."} onRetry={dealApi.reload} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Notional" value={fmtMoney(deal.notionalAmount, deal.currency)} mono />
        <Stat label="Type" value={dealTypeLabel[deal.type]} />
        <Stat label="Settlement date" value={deal.settlementDate ? fmtDate(deal.settlementDate) : "—"} mono />
        <Stat label="Created" value={fmtDate(deal.createdAt)} mono />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Deal record"
              icon={<Layers3 className="size-4 text-faint" />}
              right={
                canTransition ? (
                  <Button size="sm" onClick={() => setTransitionOpen(true)}>
                    Move status
                  </Button>
                ) : undefined
              }
            />
            <div className="border-t border-line" />
            <KeyValues
              values={[
                ["Reference", <span className="mono" key="r">{deal.reference}</span>],
                ["Name", deal.name],
                ["Description", deal.description ?? "—"],
                ["Denominated currency", deal.currency],
                ["Target settlement", deal.settlementDate ? fmtDate(deal.settlementDate) : "Not set"],
                ["Created", fmtDate(deal.createdAt)],
                ["Last activity", timeAgo(deal.updatedAt)],
                ["Current version", <span className="mono" key="v">v{deal.version}</span>],
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Deal history" icon={<Calendar className="size-4 text-faint" />} subtitle="Every transition is immutably recorded" />
            <div className="divide-y divide-line">
              {transitions.length === 0 ? (
                <p className="px-4 py-5 text-sm text-faint">No transitions yet.</p>
              ) : (
                transitions.map((t, i) => (
                  <div key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="mt-1.5 flex flex-col items-center">
                      <span className="size-2 rounded-full bg-accent-strong" />
                      {i < transitions.length - 1 && <span className="mt-1 h-full min-h-4 w-px bg-line-strong" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-paper">
                        <span className="mono text-faint">{t.fromStatus}</span>
                        <span className="mx-1.5 text-faintest">→</span>
                        <span className="font-medium">{humanLabel(t.toStatus)}</span>
                      </p>
                      {t.reason && <p className="mt-0.5 text-xs text-muted">{t.reason}</p>}
                      <p className="mt-0.5 text-[11px] text-faintest">
                        {t.createdAt ? timeAgo(t.createdAt) : ""}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Approval workflow" icon={<Gavel className="size-4 text-faint" />} />
            <div className="border-t border-line" />
            <div className="flex flex-col gap-3 p-4">
              {workflows.length === 0 ? (
                <p className="text-xs text-faint">No approval workflow started for this deal.</p>
              ) : (
                workflows.map((w) => (
                  <div key={w.id} className="rounded-xl border border-line bg-ink-925 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-paper">Policy workflow</span>
                      <StatusChip size="xs" label={humanLabel(w.status)} tone={toneFor.workflow(w.status)} />
                    </div>
                    <p className="mt-2 text-[11px] text-faintest">
                      {w.startedAt ? `started ${timeAgo(w.startedAt)}` : "not started"}
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Readiness" icon={<ListChecks className="size-4 text-faint" />} subtitle="Satisfied requirement coverage" />
            <div className="border-t border-line" />
            <div className="p-4">
              {readiness ? (
                <>
                  <div className="mb-1 flex items-baseline justify-between">
                    <span className="text-sm text-muted">
                      {readiness.satisfied} of {readiness.required} satisfied
                    </span>
                    <span className="mono text-sm text-paper">
                      {readiness.required === 0 ? "0%" : Math.round((readiness.satisfied / readiness.required) * 100)}%
                    </span>
                  </div>
                  <Progress
                    value={readiness.required === 0 ? 0 : Math.round((readiness.satisfied / readiness.required) * 100)}
                    tone={toneFor.requirement(readiness.requirements.find((r) => r.satisfied === false) ? "OPEN" : "SATISFIED")}
                  />
                </>
              ) : (
                <p className="text-xs text-faintest">Loading integrity status…</p>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={transitionOpen}
        onClose={() => setTransitionOpen(false)}
        title={`Transition · v${deal.version}`}
        description="Status changes are recorded with cryptographic immutability."
      >
        <div className="flex flex-col gap-4">
          <Field label="Move deal to">
            <Select
              value={toStatus}
              onChange={(e) => setToStatus(e.target.value)}
              placeholder="Choose next status"
              options={(transitionableStatuses[deal.status] ?? []).map((s) => ({
                value: s,
                label: humanLabel(s),
              }))}
            />
          </Field>
          <Field label="Reason">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this status changing?" rows={3} />
          </Field>
          {error && <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTransitionOpen(false)}>Cancel</Button>
            <Button onClick={submitTransition} loading={busy} disabled={!toStatus || busy}>
              Submit transition
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}