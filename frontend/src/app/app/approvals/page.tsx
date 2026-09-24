"use client";

import { useState } from "react";
import { Gavel } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { humanLabel, toneFor } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Empty, Loading } from "@/components/ui/atoms";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { ApprovalRequest, ApprovalWorkflow } from "@/lib/types";

export default function ApprovalsPage() {
  const { activeOrg } = useSession();
  const { push } = useToast();
  const orgId = activeOrg?.organizationId ?? "";

  const requestsApi = useApi<{ requests: ApprovalRequest[]; total: number }>(
    orgId ? `/organizations/${orgId}/approval-requests` : null,
  );
  const workflowsApi = useApi<{ workflows: ApprovalWorkflow[]; total: number }>(
    orgId ? `/organizations/${orgId}/approval-workflows` : null,
  );

  const requests = requestsApi.data?.requests ?? [];
  const workflows = workflowsApi.data?.workflows ?? [];

  const decide = async (req: ApprovalRequest, action: "APPROVE" | "REJECT") => {
    try {
      await post(`/organizations/${orgId}/approval-requests/${req.id}/decide`, {
        action,
        reason: action === "REJECT" ? "Rejected by operator." : undefined,
      });
      push({ kind: "success", title: `Request ${action.toLowerCase()}d` });
      requestsApi.reload();
      workflowsApi.reload();
    } catch (e) {
      push({ kind: "error", title: "Decision failed", message: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <CardHeader
          title="Approvals"
          subtitle="Multi-party workflows triggered as deals approach the settlement line"
          icon={<Gavel className="size-4 text-faint" />}
        />
      </div>

      <Tabs defaultValue="requests">
        <TabsList>
          <TabsTrigger value="requests">Requests</TabsTrigger>
          <TabsTrigger value="workflows">Workflows</TabsTrigger>
        </TabsList>

        <TabsContent value="requests">
          <Card>
            {requestsApi.loading ? (
              <Loading rows={6} className="p-4" />
            ) : requests.length === 0 ? (
              <Empty title="No approval requests" message="Requests appear here when a workflow advances to your step." icon={<Gavel className="size-5" />} />
            ) : (
              <div className="divide-y divide-line">
                {requests.map((r) => (
                  <RequestRow key={r.id} request={r} onDecide={(a) => decide(r, a)} />
                ))}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="workflows">
          <Card>
            {workflowsApi.loading ? (
              <Loading rows={6} className="p-4" />
            ) : workflows.length === 0 ? (
              <Empty title="No workflows" message="No approval workflows have run in this organization." icon={<Gavel className="size-5" />} />
            ) : (
              <div className="divide-y divide-line">
                {workflows.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm text-paper">Workflow</p>
                      <p className="mono text-[11px] text-faintest">{w.id.slice(0, 8)}…</p>
                    </div>
                    <StatusChip size="xs" label={humanLabel(w.status)} tone={toneFor.workflow(w.status)} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function RequestRow({
  request,
  onDecide,
}: {
  request: ApprovalRequest;
  onDecide: (action: "APPROVE" | "REJECT") => void;
}) {
  const [busy, setBusy] = useState<"APPROVE" | "REJECT" | null>(null);
  const run = async (a: "APPROVE" | "REJECT") => {
    setBusy(a);
    await onDecide(a);
    setBusy(null);
  };
  const mine = request.workflow?.status === "PENDING" && request.status === "PENDING";

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-paper">Step {request.sequence}</span>
          {request.required ? (
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-faintest">required</span>
          ) : null}
          <StatusChip size="xs" label={humanLabel(request.status)} tone={toneFor.request(request.status)} />
        </div>
        <p className="mt-1 text-xs text-muted">
          {request.approver?.email ?? "Unknown approver"}
        </p>
        {(request.reason || request.dueAt) && (
          <p className="mt-0.5 text-[11px] text-faintest">
            {request.reason ?? ""}
            {request.dueAt ? ` · due ${fmtDate(request.dueAt)}` : ""}
          </p>
        )}
      </div>
      {mine && (
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="success" loading={busy === "APPROVE"} onClick={() => run("APPROVE")}>
            Approve
          </Button>
          <Button size="sm" variant="danger" loading={busy === "REJECT"} onClick={() => run("REJECT")}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}