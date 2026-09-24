"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { fmtMoney, timeAgo } from "@/lib/format";
import { dealTypeLabel, humanLabel, toneFor } from "@/lib/status";
import { StatusChip } from "@/components/ui/badge";
import type { PublicDeal } from "@/lib/types";

const tabs = [
  { key: "overview", label: "Overview", href: "" },
  { key: "room", label: "Room", href: "/room" },
  { key: "intelligence", label: "Intelligence", href: "/intelligence" },
  { key: "settlement", label: "Settlement", href: "/settlement" },
  { key: "audit", label: "Audit trail", href: "/audit" },
];

export default function DealLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const pathname = usePathname();
  const router = useRouter();
  const { activeOrg } = useSession();

  const dealApi = useApi<{ deal: PublicDeal }>(
    activeOrg && dealId ? `/organizations/${activeOrg.organizationId}/deals/${dealId}` : null,
  );
  const deal = dealApi.data?.deal;

  const active = tabs.find((t) => {
    const suffix = t.href;
    return suffix === ""
      ? pathname === `/app/deals/${dealId}`
      : pathname === `/app/deals/${dealId}${suffix}`;
  })?.key ?? "overview";

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div>
        <button
          onClick={() => router.push("/app/deals")}
          className="focus-ring -ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-faint hover:text-muted"
        >
          <ArrowLeft className="size-4" />
          Deals
        </button>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-paper">
                {deal ? deal.name : "Deal"}
              </h1>
              {deal && (
                <StatusChip
                  label={humanLabel(deal.status)}
                  tone={toneFor.deal(deal.status)}
                  dot
                  pulse={["NEGOTIATING", "APPROVAL_PENDING", "SETTLEMENT_PENDING"].includes(deal.status)}
                />
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              <span className="mono text-faint">{deal ? deal.reference : "…"}</span>
              {deal && (
                <>
                  <span>{dealTypeLabel[deal.type]}</span>
                  <span className="font-mono tabular">
                    {fmtMoney(deal.notionalAmount, deal.currency)}
                  </span>
                  <span className="text-faintest">v{deal.version}</span>
                  <span className="text-faintest">updated {deal ? timeAgo(deal.updatedAt) : ""}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <nav className="-mb-px flex items-center gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/app/deals/${dealId}${t.href}`}
            className={cn(
              "focus-ring -mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
              active === t.key
                ? "border-accent-strong font-medium text-paper"
                : "border-transparent text-faint hover:text-muted",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {dealApi.error ? (
        <div className="panel-raise p-6 text-sm text-rose">{dealApi.error}</div>
      ) : (
        children
      )}
    </div>
  );
}