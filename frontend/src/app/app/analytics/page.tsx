"use client";

import { BarChart3, Landmark } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { qs } from "@/lib/api";
import { fmtMoney, timeAgo } from "@/lib/format";
import { dealTypeLabel, humanLabel, toneFor } from "@/lib/status";
import { Card, CardHeader, Stat, THead, TBody, Table, Tr, Td } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Empty, Loading } from "@/components/ui/atoms";
import type { PublicDeal, PublicDealPage } from "@/lib/types";

const STATUSES = [
  "DRAFT",
  "OPEN",
  "NEGOTIATING",
  "AGREED",
  "APPROVAL_PENDING",
  "APPROVED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "RECONCILING",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "DISPUTED",
] as const;

export default function AnalyticsPage() {
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";

  const dealsApi = useApi<PublicDealPage>(
    orgId ? `/organizations/${orgId}/deals${qs({ limit: 100 })}` : null,
  );
  const deals = dealsApi.data?.deals ?? [];
  const total = dealsApi.data?.total ?? 0;

  const byStatus = new Map<string, PublicDeal[]>();
  for (const d of deals) {
    const arr = byStatus.get(d.status) ?? [];
    arr.push(d);
    byStatus.set(d.status, arr);
  }

  const active = deals.filter((d) =>
    ["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "APPROVED", "SETTLEMENT_PENDING", "SETTLED", "RECONCILING"].includes(d.status),
  );
  const activeNotional = active.reduce((sum, d) => sum + parseFloat(d.notionalAmount), 0);
  const completed = deals.filter((d) => d.status === "COMPLETED").length;
  const failed = deals.filter((d) => ["FAILED", "DISPUTED"].includes(d.status)).length;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <p className="eyebrow">Analytics</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Pipeline posture</h1>
        <p className="mt-1 text-sm text-muted">Distribution of deal state across this organization.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total deals" value={String(total)} mono />
        <Stat label="Active notional" value={fmtMoney(activeNotional, "USD", { compact: true })} mono tone="accent" />
        <Stat label="Completed" value={String(completed)} mono />
        <Stat label="At risk" value={String(failed)} mono tone={failed > 0 ? "rose" : "neutral"} />
      </div>

      <Card>
        <CardHeader title="Distribution by status" icon={<BarChart3 className="size-4 text-faint" />} subtitle="Latest 100 deals sampled" />
        <div className="flex flex-col gap-2.5 p-4">
          {dealsApi.loading ? (
            <Loading rows={6} />
          ) : deals.length === 0 ? (
            <Empty title="Nothing to chart" message="Create a deal to start building analytics here." icon={<Landmark className="size-5" />} />
          ) : (
            STATUSES.map((s) => {
              const bucket = byStatus.get(s) ?? [];
              const pct = bucket.length ? Math.max(3, Math.round((bucket.length / deals.length) * 100)) : 0;
              return (
                <div key={s} className="grid grid-cols-[150px_1fr_48px] items-center gap-3">
                  <div className="flex items-center gap-2">
                    <StatusChip size="xs" label={humanLabel(s)} tone={toneFor.deal(s)} />
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-accent-strong/80 transition-all"
                      style={{ width: pct ? `${Math.max(pct * 1.4, 4)}%` : "0%" }}
                    />
                  </div>
                  <span className="mono text-right text-xs text-faintest">{bucket.length}</span>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Deal table" subtitle="All sampled deals" />
        <Table>
          <THead>
            <tr>
              <th>Deal</th>
              <th>Type</th>
              <th className="text-right">Notional</th>
              <th>Status</th>
              <th className="text-right">Updated</th>
            </tr>
          </THead>
          <TBody>
            {deals.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <div>
                    <p className="text-sm text-paper">{d.name}</p>
                    <p className="mono text-[11px] text-faintest">{d.reference}</p>
                  </div>
                </Td>
                <Td className="text-muted">{dealTypeLabel[d.type]}</Td>
                <Td right mono>{fmtMoney(d.notionalAmount, d.currency)}</Td>
                <Td>
                  <StatusChip size="xs" label={humanLabel(d.status)} tone={toneFor.deal(d.status)} />
                </Td>
                <Td right className="text-xs text-faintest">{timeAgo(d.updatedAt)}</Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}