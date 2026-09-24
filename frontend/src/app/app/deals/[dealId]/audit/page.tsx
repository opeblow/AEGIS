"use client";

import { useParams } from "next/navigation";
import { CalendarClock, FileKey, Fingerprint, ScanSearch } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { qs } from "@/lib/api";
import { fmtDate, timeAgo, fmtHash } from "@/lib/format";
import { humanLabel } from "@/lib/status";
import { Card, CardHeader } from "@/components/ui/data";
import { Loading, Empty } from "@/components/ui/atoms";
import type { PublicDealTransition } from "@/lib/types";

export default function DealAudit() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";

  const historyApi = useApi<{ transitions: PublicDealTransition[] }>(
    orgId && dealId ? `/organizations/${orgId}/deals/${dealId}/history` : null,
  );
  const eventsApi = useApi<{ events: AuditEvent[] }>(
    orgId ? `/organizations/${orgId}/security-events${qs({ limit: 40 })}` : null,
  );

  const transitions = historyApi.data?.transitions ?? [];
  const events = (eventsApi.data?.events ?? []).filter((e) =>
    e.metadata?.dealId === dealId,
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader
          title="State transitions"
          subtitle="Immutably recorded status history"
          icon={<CalendarClock className="size-4 text-faint" />}
        />
        <div className="border-t border-line" />
        {historyApi.loading ? (
          <Loading rows={5} className="p-4" />
        ) : transitions.length === 0 ? (
          <div className="p-4">
            <Empty title="No transitions" message="Deal was created but has not moved." icon={<CalendarClock className="size-5" />} />
          </div>
        ) : (
          <div className="flex flex-col">
            {transitions.map((t, i) => (
              <div key={t.id} className="flex items-start gap-4 border-b border-line px-4 py-3 last:border-0">
                <div className="mt-1 flex flex-col items-center">
                  <span className={`size-2 rounded-full ${t.fromStatus === t.toStatus ? "bg-line-strong" : "bg-accent-strong"}`} />
                  {i < transitions.length - 1 && <span className="mt-1 w-px flex-1 bg-line" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-xs text-faint">{t.fromStatus}</span>
                    <span className="text-faintest">→</span>
                    <span className="text-sm font-medium text-paper">{humanLabel(t.toStatus)}</span>
                    {t.requestId && (
                      <span className="mono inline-flex items-center gap-1 text-[10px] text-faintest">
                        <FileKey className="size-3" /> {fmtHash(t.requestId)}
                      </span>
                    )}
                  </div>
                  {t.reason && <p className="mt-1 text-xs text-muted">{t.reason}</p>}
                  <p className="mt-1 text-[11px] text-faintest">
                    {fmtDate(t.createdAt)} · {timeAgo(t.createdAt)}
                    {t.actorUserId && <span className="mono"> · by {fmtHash(t.actorUserId)}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Security events"
          subtitle="Audit events tied to this deal"
          icon={<ScanSearch className="size-4 text-faint" />}
        />
        <div className="border-t border-line" />
        {events.length === 0 ? (
          <div className="p-4">
            <Empty title="No security events" message="Nothing audited on this deal yet." icon={<Fingerprint className="size-5" />} />
          </div>
        ) : (
          <div className="divide-y divide-line">
            {events.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="mono text-xs text-paper">{e.type}</p>
                  {e.actor && <p className="truncate text-[11px] text-faintest">{e.actor.email}</p>}
                </div>
                <span className="shrink-0 text-xs text-faintest">{timeAgo(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

interface AuditEvent {
  id: string;
  createdAt: string;
  type: string;
  organizationId: string;
  actor: { id: string; email: string } | null;
  metadata: Record<string, unknown> | null;
}