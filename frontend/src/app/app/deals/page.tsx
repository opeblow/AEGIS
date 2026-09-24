"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Filter, Landmark, Plus } from "lucide-react";
import { useSession } from "@/lib/session";
import { usePageApi } from "@/lib/hooks";
import { fmtMoney, timeAgo } from "@/lib/format";
import { dealTypeLabel, humanLabel, toneFor } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/inputs";
import { Card, Table, TBody, THead, Td, Tr } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Loading, ErrorState, Empty } from "@/components/ui/atoms";
import type { PublicDealPage, PublicDeal } from "@/lib/types";
import { useState } from "react";

const statusOptions = [
  { value: "DRAFT", label: "Draft" },
  { value: "OPEN", label: "Open" },
  { value: "NEGOTIATING", label: "Negotiating" },
  { value: "AGREED", label: "Agreed" },
  { value: "APPROVAL_PENDING", label: "Approval pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "SETTLEMENT_PENDING", label: "Settlement pending" },
  { value: "SETTLED", label: "Settled" },
  { value: "RECONCILING", label: "Reconciling" },
  { value: "COMPLETED", label: "Completed" },
  { value: "EXPIRED", label: "Expired" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "FAILED", label: "Failed" },
  { value: "DISPUTED", label: "Disputed" },
];

const typeOptions = [
  { value: "RWA_PURCHASE", label: "RWA Purchase" },
  { value: "RWA_SALE", label: "RWA Sale" },
  { value: "PRIVATE_TRADE", label: "Private Trade" },
  { value: "OTHER", label: "Other" },
];

export default function DealsPage() {
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");

  const page = usePageApi<PublicDealPage>(
    orgId ? `/organizations/${orgId}/deals` : null,
    { status: status || undefined, limit: 25 },
  );

  const deals = page.data?.deals ?? [];
  const total = page.data?.total ?? 0;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Deals</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">
            Deal pipeline
          </h1>
          <p className="mt-1 text-sm text-muted">
            {total} {total === 1 ? "deal" : "deals"} in this organization.
          </p>
        </div>
        <Link href="/app/deals/new">
          <Button icon={<Plus className="size-4" />}>New deal</Button>
        </Link>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Filter className="size-4 text-faint" />
          <Select
            className="w-44"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder="All statuses"
            options={[{ value: "", label: "All statuses" }, ...statusOptions]}
          />
          <Select
            className="w-44"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="All types"
            options={[{ value: "", label: "All types" }, ...typeOptions]}
          />
          <Input
            className="w-56"
            placeholder="Search by name or reference…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {page.loading ? (
          <Loading rows={6} className="m-4" />
        ) : page.error ? (
          <div className="m-4">
            <ErrorState message={page.error} onRetry={page.reload} />
          </div>
        ) : deals.length === 0 ? (
          <Empty
            title="No deals match"
            message="Adjust the filters or start a new deal."
            icon={<Landmark className="size-5" />}
            action={
              <Link href="/app/deals/new" className="text-xs text-accent hover:underline">
                New deal
              </Link>
            }
          />
        ) : (
          <DealTable deals={deals.filter(byQuery(q))} />
        )}

        {total > 25 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
            <span className="text-xs text-faintest">
              Page {page.page} of {Math.max(1, Math.ceil(total / 25))}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page.page <= 1} onClick={() => page.setPage(page.page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page.page * 25 >= total}
                onClick={() => page.setPage(page.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function byQuery(q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return () => true;
  return (d: PublicDeal) =>
    d.name.toLowerCase().includes(needle) ||
    d.reference.toLowerCase().includes(needle) ||
    d.type.toLowerCase().includes(needle);
}

function DealTable({ deals }: { deals: PublicDeal[] }) {
  const router = useRouter();
  return (
    <Table>
      <THead>
        <tr>
          <th>Deal</th>
          <th>Type</th>
          <th className="text-right">Notional</th>
          <th>Status</th>
          <th className="text-right">Version</th>
          <th className="text-right">Updated</th>
        </tr>
      </THead>
      <TBody>
        {deals.map((d) => (
          <Tr key={d.id} onClick={() => router.push(`/app/deals/${d.id}`)}>
            <Td>
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg border border-line bg-ink-925">
                  <Landmark className="size-3.5 text-faint" />
                </div>
                <div>
                  <p className="font-medium text-paper">{d.name}</p>
                  <p className="mono text-[11px] text-faintest">{d.reference}</p>
                </div>
              </div>
            </Td>
            <Td className="text-muted">{dealTypeLabel[d.type]}</Td>
            <Td right mono>{fmtMoney(d.notionalAmount, d.currency)}</Td>
            <Td>
              <StatusChip label={humanLabel(d.status)} tone={toneFor.deal(d.status)} />
            </Td>
            <Td right className="mono text-faintest">
              v{d.version}
            </Td>
            <Td right className="text-xs text-faintest">
              {timeAgo(d.updatedAt)}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}