"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowUpRight,
  Gavel,
  Hash,
  Landmark,
  Layers3,
  ShieldCheck,
  SquareKanban,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { qs } from "@/lib/api";
import { fmtMoney, timeAgo } from "@/lib/format";
import { humanLabel, toneFor, TONES } from "@/lib/status";
import {
  Card,
  CardHeader,
  Stat,
  Table,
  THead,
  TBody,
  Tr,
  Td,
} from "@/components/ui/data";
import { Loading, ErrorState, Empty } from "@/components/ui/atoms";
import { StatusChip } from "@/components/ui/badge";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import type {
  ApprovalWorkflow,
  PublicCounterparty,
  PublicDeal,
  PublicDealPage,
} from "@/lib/types";

export default function CommandCenter() {
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";
  const router = useRouter();

  const deals = useApi<PublicDealPage>(
    orgId ? `/organizations/${orgId}/deals${qs({ limit: 6 })}` : null,
  );
  const dealsData = deals.data?.deals ?? [];

  const activeCount = dealsData.filter((d) =>
    ["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "SETTLEMENT_PENDING", "RECONCILING"].includes(d.status),
  ).length;

  const pendingReviews = dealsData.reduce(
    (sum, d) => sum + (d.status === "APPROVAL_PENDING" ? 1 : 0),
    0,
  );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      {/* Heading */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Command center</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">
            {activeOrg?.organization?.name ?? "Aegis"}
          </h1>
        </div>
        <StatBand
          deals={dealsData.length}
          active={activeCount}
          reviews={pendingReviews}
          loading={deals.loading}
        />
      </div>

      <DealPulse deals={dealsData} loading={deals.loading} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Tabs defaultValue="deals">
            <TabsList>
              <TabsTrigger value="deals" icon={<SquareKanban className="size-3.5" />}>
                Active deals
              </TabsTrigger>
              <TabsTrigger value="approvals" icon={<Gavel className="size-3.5" />}>
                Approvals
              </TabsTrigger>
              <TabsTrigger value="counterparties" icon={<Layers3 className="size-3.5" />}>
                Counterparties
              </TabsTrigger>
              <TabsTrigger value="activity" icon={<Activity className="size-3.5" />}>
                Ledger activity
              </TabsTrigger>
            </TabsList>

            <TabsContent value="deals" className="pt-4">
              {deals.loading ? (
                <Loading rows={4} />
              ) : deals.error ? (
                <ErrorState message={deals.error} onRetry={deals.reload} />
              ) : dealsData.length === 0 ? (
                <Empty
                  title="No deals yet"
                  message="Use the workspaces below or start a new deal to open the negotiation room."
                  icon={<SquareKanban className="size-5" />}
                  action={
                    <Link
                      href="/app/deals/new"
                      className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-paper px-3 text-xs font-medium text-ink-950 hover:bg-white"
                    >
                      <Landmark className="size-3.5" />
                      New deal
                    </Link>
                  }
                />
              ) : (
                <Table>
                  <THead>
                    <tr>
                      <th>Deal</th>
                      <th className="text-right">Notional</th>
                      <th>Status</th>
                      <th className="text-right">Updated</th>
                    </tr>
                  </THead>
                  <TBody>
                    {dealsData.map((d) => (
                      <Tr key={d.id} onClick={() => router.push(`/app/deals/${d.id}`)}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <div className="flex size-7 items-center justify-center rounded-lg border border-line bg-ink-925">
                              <Landmark className="size-3.5 text-faint" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-paper">{d.name}</p>
                              <p className="mono text-[11px] text-faintest">{d.reference}</p>
                            </div>
                          </div>
                        </Td>
                        <Td right mono>
                          {fmtMoney(d.notionalAmount, d.currency)}
                        </Td>
                        <Td>
                          <StatusChip
                            label={humanLabel(d.status)}
                            tone={toneFor.deal(d.status)}
                          />
                        </Td>
                        <Td right className="text-xs text-faintest">
                          {timeAgo(d.updatedAt)}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </TabsContent>

            <TabsContent value="approvals" className="pt-4">
              <ApprovalsPanel orgId={orgId} />
            </TabsContent>

            <TabsContent value="counterparties" className="pt-4">
              <CounterpartiesPanel orgId={orgId} />
            </TabsContent>

            <TabsContent value="activity" className="pt-4">
              <ActivityPanel orgId={orgId} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-6">
          <QuickActions />
          <LatestEvents orgId={orgId} />
        </div>
      </div>
    </div>
  );
}

function StatBand({
  deals,
  active,
  reviews,
  loading,
}: {
  deals: number;
  active: number;
  reviews: number;
  loading: boolean;
}) {
  return (
    <div className="grid grid-cols-3 gap-8">
      <Stat label="Deals" value={loading ? "…" : deals} tone={active > 0 ? "accent" : "neutral"} />
      <Stat label="In flight" value={active} tone="steel" />
      <Stat label="Approval reviews" value={reviews} tone={reviews > 0 ? "amber" : "neutral"} />
    </div>
  );
}

function DealPulse({ deals, loading }: { deals: PublicDeal[] | null; loading: boolean }) {
  if (loading || !deals) return <div className="skeleton h-20 rounded-xl" />;
  const counts: Record<string, number> = {};
  for (const d of deals) counts[d.status] = (counts[d.status] ?? 0) + 1;
  const order = ["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "APPROVED", "SETTLEMENT_PENDING", "SETTLED", "COMPLETED"];
  const segments = order
    .filter((s) => counts[s])
    .map((s) => ({ status: s, count: counts[s] }));
  if (segments.length === 0) return null;
  return (
    <Card raised className="py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-4 px-4">
        {["OPEN", "NEGOTIATING", "AGREED", "APPROVAL_PENDING", "SETTLED", "COMPLETED"].map(
          (s) => {
            const n = counts[s] ?? 0;
            const tone = toneFor.deal(s as PublicDeal["status"]);
            const dot = TONES[tone].color;
            return (
              <div key={s} className="flex flex-col items-center gap-1">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: dot }} />
                  <span className="tabular text-lg font-semibold text-paper">{n}</span>
                </span>
                <span className="eyebrow">{humanLabel(s)}</span>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
}

const KANBAN = [
  { label: "Review deal room", icon: Landmark, href: (id: string) => `/app/deals/${id}/room`, needsDeal: true },
  { label: "Approval policies", icon: Gavel, href: () => "/app/approvals", needsDeal: false },
  { label: "Deals analytics", icon: Activity, href: () => "/app/analytics", needsDeal: false },
  { label: "Security verdict log", icon: ShieldCheck, href: () => "/app/audit", needsDeal: false },
];

function QuickActions() {
  const { data: firstDeal } = useApi<{ deal: PublicDeal } | null>(null);
  const router = useRouter();
  void firstDeal;
  return (
    <Card>
      <CardHeader title="Workspaces" subtitle="Jump to an operational surface" />
      <div className="divide-y divide-line">
        <Link
          href="/app/deals/new"
          className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-850"
        >
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <Landmark className="size-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-paper">New deal</p>
            <p className="text-xs text-faintest">Create and open a negotiation room</p>
          </div>
          <ArrowUpRight className="size-3.5 text-faintest" />
        </Link>
        {KANBAN.map((k) => (
          <Link
            key={k.label}
            href={k.href("")}
            onClick={(e) => {
              if (k.needsDeal) {
                e.preventDefault();
                const dealsLink = document.querySelector<HTMLAnchorElement>('a[href="/app/deals"]');
                if (dealsLink) router.push("/app/deals");
                else router.push("/app/deals");
              }
            }}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink-850"
          >
            <div className="flex size-8 items-center justify-center rounded-lg border border-line bg-ink-925 text-faint">
              <k.icon className="size-4" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-paper">{k.label}</p>
              <p className="text-xs text-faintest">Command surfaces for live operations</p>
            </div>
            <ArrowUpRight className="size-3.5 text-faintest" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function LatestEvents({ orgId }: { orgId: string }) {
  type Ev = { id: string; createdAt: string; type: string; actor: { email: string } | null; metadata: Record<string, unknown> | null };
  const events = useApi<{ events: Ev[] }>(
    orgId ? `/organizations/${orgId}/security-events${qs({ limit: 5 })}` : null,
  );
  const items = events.data?.events ?? [];
  return (
    <Card>
      <CardHeader
        title="Latest ledger events"
        subtitle="Every audited action on this account"
        icon={<ShieldCheck className="size-4 text-faint" />}
      />
      <div className="divide-y divide-line">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-xs text-faintest">No audited events yet.</p>
        ) : (
          items.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="mono truncate text-xs text-muted">{e.type}</p>
                {e.metadata && Object.keys(e.metadata).length > 0 && (
                  <p className="truncate text-[11px] text-faintest">
                    {Object.entries(e.metadata)
                      .slice(0, 3)
                      .map(([k, v]) => `${k}=${String(v)}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <span className="shrink-0 text-xs text-faintest">{timeAgo(e.createdAt)}</span>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function ApprovalsPanel({ orgId }: { orgId: string }) {
  const router = useRouter();
  const wf = useApi<{ workflows: ApprovalWorkflow[]; total: number }>(
    orgId ? `/organizations/${orgId}/approval-workflows` : null,
  );
  const items = wf.data?.workflows ?? [];
  if (wf.loading) return <Loading rows={3} />;
  if (items.length === 0)
    return (
      <Empty
        title="No approval workflows"
        message="Start an approval workflow on a deal that has reached AGREED."
        icon={<Gavel className="size-5" />}
        action={<Link href="/app/approvals" className="focus-ring text-xs text-accent hover:underline">Manage policies</Link>}
      />
    );
  return (
    <Table>
      <THead>
        <tr>
          <th>Deal</th>
          <th>Status</th>
          <th className="text-right">Started</th>
        </tr>
      </THead>
      <TBody>
        {items.map((wfItem) => (
          <Tr key={wfItem.id} onClick={() => router.push(`/app/deals/${wfItem.dealId}/settlement`)}>
            <Td className="mono font-medium text-paper">{wfItem.dealId.slice(0, 8)}</Td>
            <Td>
              <StatusChip label={humanLabel(wfItem.status)} tone={toneFor.workflow(wfItem.status)} />
            </Td>
            <Td right className="text-xs text-faintest">{wfItem.startedAt ? timeAgo(wfItem.startedAt) : "—"}</Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

function CounterpartiesPanel({ orgId }: { orgId: string }) {
  const cp = useApi<{ counterparties: PublicCounterparty[] }>(
    orgId ? `/organizations/${orgId}/counterparties` : null,
  );
  const items = cp.data?.counterparties ?? [];
  if (cp.loading) return <Loading rows={3} />;
  if (items.length === 0)
    return (
      <Empty
        title="No counter-parties yet"
        message="A deal needs an active, verified deal partner before the negotiation room can open."
        icon={<Layers3 className="size-5" />}
      />
    );
  return (
    <Table>
      <THead>
        <tr>
          <th>Organization</th>
          <th>Relationship</th>
          <th>Verification</th>
          <th className="text-right">Since</th>
        </tr>
      </THead>
      <TBody>
        {items.map((c) => (
          <Tr key={c.id}>
            <Td className="font-medium text-paper">{c.counterpartyOrganizationName ?? "Counterparty"}</Td>
            <Td>
              <StatusChip label={humanLabel(c.status)} tone={toneFor.document("ACCEPTED") as "accent"} />
            </Td>
            <Td>
              {c.verificationStatus === "VERIFIED" ? (
                <StatusChip label="Verified" tone="accent" />
              ) : (
                <StatusChip
                  label={humanLabel(c.verificationStatus)}
                  tone={c.verificationStatus === "PENDING" ? "amber" : "neutral"}
                />
              )}
            </Td>
            <Td right className="text-xs text-faintest">
              {timeAgo(c.createdAt)}
            </Td>
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}

function ActivityPanel({ orgId }: { orgId: string }) {
  type Ev = { createdAt: string; type: string };
  const ev = useApi<{ events: Ev[] }>(
    orgId ? `/organizations/${orgId}/security-events` : null,
  );
  const items = ev.data?.events ?? [];
  if (ev.loading) return <Loading rows={3} />;
  if (items.length === 0)
    return <Empty title="No ledger events" icon={<Activity className="size-5" />} />;
  return (
    <div className="divide-y divide-line">
      {items.slice(0, 8).map((e, i) => (
        <div key={i} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex size-7 items-center justify-center rounded-lg border border-line bg-ink-925">
              {e.type.includes("SECURITY") ? (
                <ShieldCheck className="size-3.5 text-steel" />
              ) : (
                <Hash className="size-3.5 text-faint" />
              )}
            </div>
            <span className="mono text-xs text-muted">{e.type}</span>
          </div>
          <span className="shrink-0 text-xs text-faintest">{timeAgo(e.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}