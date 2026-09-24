"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
  BrainCircuit,
  Flame,
  Layers3,
  Send,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate, timeAgo } from "@/lib/format";
import { humanLabel } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KeyValues } from "@/components/ui/data";
import { StatusChip, Progress } from "@/components/ui/badge";
import { Empty, Loading, Muted } from "@/components/ui/atoms";
import { useToast } from "@/components/ui/toast";
import type { PublicDealIntelligenceRun } from "@/lib/types";
import { cn } from "@/lib/cn";

export default function DealIntelligence() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { push } = useToast();

  const runsApi = useApi<{ runs: PublicDealIntelligenceRun[]; total: number }>(
    dealId ? `/deals/${dealId}/intelligence` : null,
  );
  const runs = runsApi.data?.runs ?? [];

  const [analyzing, setAnalyzing] = useState(false);
  const [query, setQuery] = useState("");
  const [querying, setQuerying] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    setUnavailable(false);
    try {
      await post(`/deals/${dealId}/intelligence/analyze`, {});
      push({ kind: "success", title: "Analysis started", message: "The engine is reviewing documents and state." });
      runsApi.reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Analysis failed.";
      if (/503|unavailable|not available|spool/i.test(msg)) {
        setUnavailable(true);
      } else {
        setError(msg);
      }
    } finally {
      setAnalyzing(false);
    }
  };

  const ask = async () => {
    if (!query.trim()) return;
    setQuerying(true);
    setError(null);
    setAnswer(null);
    try {
      const res = await post<{ answer: string }>(`/deals/${dealId}/intelligence/query`, {
        question: query.trim(),
      });
      setAnswer(res.answer);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Query failed.");
    } finally {
      setQuerying(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {unavailable && !error && (
        <div className="panel-raise border border-steel/25 bg-ink-900 p-4">
          <div className="flex items-center gap-2 text-sm text-paper">
            <Sparkles className="size-4 text-steel" />
            The intelligence engine is currently warm.
          </div>
          <p className="mt-1 text-xs text-muted">
            Analysis comes from an external reasoning service. When it is back,
            approve this run again — the request is idempotent and safe to retry.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Query the deal state"
              icon={<BrainCircuit className="size-4 text-faint" />}
              subtitle="Ask questions against the full negotiation surface"
            />
            <div className="flex flex-col gap-3 border-t border-line p-4">
              <textarea
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
                }}
                rows={3}
                placeholder="e.g. What documents still block settlement readiness?"
                className="focus-ring w-full rounded-lg border border-line bg-ink-925 px-3 py-2 text-sm text-paper placeholder:text-faintest"
              />
              <div className="flex items-center justify-between">
                <Muted className="text-xs">Open questions are answered against certified documents only.</Muted>
                <Button size="sm" icon={<Send className="size-4" />} loading={querying} onClick={ask} disabled={!query.trim() || querying}>
                  Ask
                </Button>
              </div>
              {answer && (
                <div className="rounded-xl border border-accent/20 bg-accent-soft p-3">
                  <p className="text-sm text-paper">{answer}</p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Analysis history"
              icon={<Layers3 className="size-4 text-faint" />}
              right={
                <Button size="sm" icon={<Sparkles className="size-4" />} loading={analyzing} onClick={analyze}>
                  Run analysis
                </Button>
              }
            />
            <div className="border-t border-line" />
            {runsApi.loading ? (
              <Loading rows={4} className="p-4" />
            ) : runs.length === 0 ? (
              <Empty
                title="No analyses yet"
                message="Run your first intelligence pass to surface risk flags and confidence scoring."
                icon={<Flame className="size-5" />}
              />
            ) : (
              <div className="flex flex-col gap-2 p-4">
                {runs.map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Risk posture" icon={<ShieldAlert className="size-4 text-faint" />} />
            <div className="border-t border-line p-4">
              {runs.length === 0 ? (
                <Muted className="text-xs">No confidence data yet.</Muted>
              ) : (
                <LatestConfidence run={runs[0]} />
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

type RiskFlag = { category?: string; severity?: string; finding?: string; explanation?: string };
type DocFinding = { title?: string; finding_type?: string; finding?: string; label?: string };

function resultFlags(run: PublicDealIntelligenceRun, key: "risk_flags" | "blockers") {
  const v = (run.result as Record<string, unknown> | null)?.[key];
  return Array.isArray(v) ? (v as RiskFlag[]) : [];
}

function resultDocs(run: PublicDealIntelligenceRun) {
  const v = (run.result as Record<string, unknown> | null)?.document_findings;
  return Array.isArray(v) ? (v as DocFinding[]) : [];
}

function RunRow({ run }: { run: PublicDealIntelligenceRun }) {
  const c = run.confidenceSummary;
  const flags = resultFlags(run, "risk_flags");
  const blockers = resultFlags(run, "blockers");
  const docs = resultDocs(run);
  return (
    <div className="rounded-xl border border-line bg-ink-925 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm text-paper">{run.provider ?? "Intelligence engine"}</p>
          <p className="text-[11px] text-faintest">
            {run.modelVersion ?? ""}
            {run.completedAt ? ` · ${timeAgo(run.completedAt)}` : ""}
          </p>
        </div>
        <StatusChip
          size="xs"
          label={humanLabel(run.status)}
          tone={run.status === "COMPLETED" ? "accent" : run.status === "FAILED" ? "rose" : "steel"}
        />
      </div>

      {run.status === "COMPLETED" && c && (
        <div className="mt-3 flex flex-col gap-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted">Model confidence</span>
            <span className="mono text-paper">{Math.round(c.confidence * 100)}%</span>
          </div>
          <Progress
            value={c.confidence}
            tone={c.confidence >= 0.7 ? "accent" : c.confidence >= 0.4 ? "amber" : "rose"}
          />
          {flags.map((f, i) => (
            <div key={f.finding ?? i} className="rounded-lg border border-amber/25 bg-amber-soft px-2.5 py-1.5">
              <p className="text-[11px] font-medium text-amber">{f.category ?? "Risk"}</p>
              <p className="text-[11px] text-muted">{f.finding ?? f.explanation}</p>
            </div>
          ))}
          <KeyValues
            values={[
              ["Risk flags", String(c.riskFlags ?? flags.length)],
              ["Document findings", String(c.documentFindings ?? docs.length)],
              ["Blockers", String(c.blockers ?? blockers.length)],
            ]}
          />
        </div>
      )}
      {run.errorCode && (
        <p className="mt-2 mono text-[11px] text-rose">{run.errorCode}</p>
      )}
    </div>
  );
}

function LatestConfidence({ run }: { run: PublicDealIntelligenceRun }) {
  const c = run.confidenceSummary;
  if (run.status !== "COMPLETED" || !c) {
    return <Muted className="text-xs">{run.status === "FAILED" ? "Last run failed." : "Latest run pending."}</Muted>;
  }
  const blockers = resultFlags(run, "blockers");
  return (
    <div className="flex flex-col gap-3">
      <p className={cn(
        "font-mono text-3xl font-semibold tabular",
        c.confidence >= 0.7 ? "text-accent-strong" : c.confidence >= 0.4 ? "text-amber" : "text-rose",
      )}>
        {Math.round(c.confidence * 100)}%
      </p>
      <p className="text-xs text-muted">{c.modelSummary ? "Model summary available." : "Model summary not generated."}</p>
      {blockers.length > 0 && (
        <div className="rounded-lg border border-rose/25 bg-rose-soft p-2.5">
          <p className="text-[11px] font-medium text-rose">Blockers</p>
          {blockers.map((b, i) => (
            <p key={b.finding ?? i} className="mt-0.5 text-[11px] text-muted">· {b.finding ?? b.explanation}</p>
          ))}
        </div>
      )}
      <p className="text-[11px] text-faintest">{run.completedAt ? fmtDate(run.completedAt) : ""}</p>
    </div>
  );
}