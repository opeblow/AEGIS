"use client";

import { useState } from "react";
import { Fingerprint, UserCheck, ShieldAlert } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { humanLabel } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Empty, Loading, ErrorState } from "@/components/ui/atoms";
import { Field, Input } from "@/components/ui/inputs";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";

export default function SecurityPage() {
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";

  const counterpartiesApi = useApi<{ counterparties: Counterparty[] }>(
    orgId ? `/organizations/${orgId}/counterparties` : null,
  );
  const eventsApi = useApi<{ events: SecurityEvent[] }>(
    orgId ? `/organizations/${orgId}/security-events` : null,
  );

  const counterparties = counterpartiesApi.data?.counterparties ?? [];
  const events = eventsApi.data?.events ?? [];

  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <p className="eyebrow">Security & Verdicts</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Counterparties & audit</h1>
        <p className="mt-1 text-sm text-muted">
          Verified counterparties, their onboarding verdicts, and the security event feed.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Counterparty relationships"
              icon={<UserCheck className="size-4 text-faint" />}
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  Link counterparty
                </Button>
              }
            />
            <div className="border-t border-line" />
            {counterpartiesApi.loading ? (
              <Loading rows={5} className="p-4" />
            ) : counterpartiesApi.error ? (
              <div className="p-4">
                <ErrorState message={counterpartiesApi.error} onRetry={counterpartiesApi.reload} />
              </div>
            ) : counterparties.length === 0 ? (
              <div className="p-4">
                <Empty title="No counterparties yet" message="Link an organization to begin negotating with them on deals." icon={<UserCheck className="size-5" />} />
              </div>
            ) : (
              <div className="divide-y divide-line">
                {counterparties.map((cp) => (
                  <div key={cp.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-paper">{cp.counterparty.name}</p>
                      <p className="text-[11px] text-faintest">
                        {cp.relationshipDirection === "outgoing" ? "Linked by you" : "Linked by them"}
                        {cp.counterparty.country ? ` · ${cp.counterparty.country}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <StatusChip size="xs" label={cp.verificationStatus === "VERIFIED" ? "Verified" : humanLabel(cp.verificationStatus)} tone={cp.verificationStatus === "VERIFIED" ? "accent" : "amber"} />
                      <StatusChip size="xs" label={humanLabel(cp.status)} tone={counterpartyTone[cp.status]} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Early signal flags" icon={<ShieldAlert className="size-4 text-faint" />} subtitle="From intelligence runs on this org's deals" />
            <div className="border-t border-line" />
            <div className="grid grid-cols-[44px_1fr_1fr] gap-0 border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faintest">
              <span>Count</span>
              <span>Flag</span>
              <span>Signal</span>
            </div>
            <div className="divide-y divide-line">
              {EMPTY_FLAGS.map((f) => (
                <div key={f.label} className="grid grid-cols-[44px_1fr_1fr] items-center px-4 py-2.5">
                  <span className="mono text-sm text-paper">{f.count}</span>
                  <span className="text-sm text-muted">{f.label}</span>
                  <span className="text-xs text-faintest">{f.signal}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <CardHeader title="Security events" icon={<Fingerprint className="size-4 text-faint" />} subtitle="Audited actions" />
          <div className="border-t border-line" />
          {eventsApi.loading ? (
            <Loading rows={6} className="p-4" />
          ) : events.length === 0 ? (
            <div className="p-4">
              <Empty title="No audit events" message="Every sensitive action lands here." icon={<Fingerprint className="size-5" />} />
            </div>
          ) : (
            <div className="flex flex-col">
              {events.slice(0, 16).map((e) => (
                <div key={e.id} className="flex items-start justify-between gap-3 border-b border-line/60 px-4 py-2.5 last:border-0">
                  <div className="min-w-0">
                    <p className="mono break-words text-[11px] leading-relaxed text-paper">{e.type}</p>
                    {e.actor && <p className="mt-0.5 truncate text-[11px] text-faintest">{e.actor.email}</p>}
                  </div>
                  <span className="shrink-0 text-[11px] text-faintest">{timeAgo(e.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Link a counterparty" description="Enter the external organization's slug. They must exist and be administered by a real user.">
        <CounterpartyForm
          orgId={orgId}
          onDone={() => {
            setAddOpen(false);
            counterpartiesApi.reload();
          }}
        />
      </Modal>
    </div>
  );
}

function CounterpartyForm({ orgId, onDone }: { orgId: string; onDone: () => void }) {
  const [counterpartyOrgId, setCounterpartyOrgId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const submit = async () => {
    if (!orgId || !counterpartyOrgId) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/organizations/${orgId}/counterparties`, {
        counterpartyOrganizationId: counterpartyOrgId,
      });
      push({ kind: "success", title: "Counterparty linked", message: "Status: PENDING — revocation or verification required by the other side." });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not link counterparty.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Counterparty organization id">
        <Input value={counterpartyOrgId} onChange={(e) => setCounterpartyOrgId(e.target.value)} placeholder="UUID of the other organization" mono />
      </Field>
      {error && <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!counterpartyOrgId || busy}>Link</Button>
      </div>
    </div>
  );
}

const EMPTY_FLAGS: { label: string; signal: string; count: number }[] = [
  { label: "Confidence < 50%", signal: "Model uncertainty", count: 0 },
  { label: "Blockers surfaced", signal: "Document gaps", count: 0 },
  { label: "Document findings", signal: "Anomalies", count: 0 },
];

interface Counterparty {
  id: string;
  relationshipDirection: "outgoing" | "incoming";
  organizationId: string;
  counterpartyOrganizationId: string;
  counterparty: {
    id: string;
    name: string;
    legalName: string | null;
    country: string | null;
  };
  status: "PENDING" | "ACTIVE" | "SUSPENDED" | "REVOKED";
  verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" | "REJECTED";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

const counterpartyTone: Record<Counterparty["status"], Tone> = {
  PENDING: "amber",
  ACTIVE: "accent",
  SUSPENDED: "rose",
  REVOKED: "neutral",
};

type Tone = "paper" | "accent" | "amber" | "rose" | "steel" | "neutral";

interface SecurityEvent {
  id: string;
  createdAt: string;
  type: string;
  organizationId: string;
  actor: { id: string; email: string } | null;
  metadata: Record<string, unknown> | null;
}