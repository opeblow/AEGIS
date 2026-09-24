"use client";

import { useState } from "react";
import { Plus, ShieldCheck, UserCog, Building2 as BuildingIcon } from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { humanLabel } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, KeyValues, Table, THead, TBody, Tr, Td } from "@/components/ui/data";
import { StatusChip } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/inputs";
import { Modal } from "@/components/ui/overlay";
import { useToast } from "@/components/ui/toast";
import { Avatar, Loading, ErrorState } from "@/components/ui/atoms";

export default function SettingsPage() {
  const { activeOrg } = useSession();
  const orgId = activeOrg?.organizationId ?? "";

  const membersApi = useApi<{ members: Membership[] }>(
    orgId ? `/organizations/${orgId}/members` : null,
  );
  const rolesApi = useApi<{ roles: RoleDetail[] }>(
    orgId ? `/organizations/${orgId}/roles` : null,
  );

  const org = activeOrg?.organization;
  const [inviteOpen, setInviteOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">
          {org?.name ?? "Organization"}
        </h1>
        {org?.slug && <p className="mono mt-1 text-xs text-faintest">@{org.slug}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Organization" icon={<BuildingIcon className="size-4 text-faint" />} />
            <div className="border-t border-line" />
            <div className="p-4">
              <KeyValues
                values={[
                  ["Name", org?.name ?? "—"],
                  ["Slug", org?.slug ? <span className="mono" key="s">@{org.slug}</span> : "—"],
                  ["Legal name", org?.legalName ?? "—"],
                  ["Country", org?.country ?? "—"],
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Members"
              icon={<UserCog className="size-4 text-faint" />}
              action={
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setInviteOpen(true)}>
                  Invite
                </Button>
              }
            />
            {membersApi.loading ? (
              <Loading rows={4} className="p-4" />
            ) : membersApi.error ? (
              <div className="p-4">
                <ErrorState message={membersApi.error} onRetry={membersApi.reload} />
              </div>
            ) : (
              <Table>
                <THead>
                  <tr>
                    <th>Member</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th className="text-right">Joined</th>
                  </tr>
                </THead>
                <TBody>
                  {(membersApi.data?.members ?? []).map((m) => (
                    <Tr key={m.id}>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={m.user.email} />
                          <div>
                            <p className="text-sm text-paper">{m.user.email}</p>
                            <p className="mono text-[11px] text-faintest">{m.user.id.slice(0, 8)}…</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-muted">{m.role?.name ?? "—"}</span>
                      </Td>
                      <Td>
                        <StatusChip size="xs" label={humanLabel(m.status)} tone={m.status === "ACTIVE" ? "accent" : "rose"} />
                      </Td>
                      <Td right className="text-xs text-faintest">
                        {m.joinedAt ? fmtDate(m.joinedAt) : "—"}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Access roles" icon={<ShieldCheck className="size-4 text-faint" />} subtitle="System roles with their permission set" />
            <div className="border-t border-line" />
            <div className="flex flex-col gap-3 p-4">
              {(rolesApi.data?.roles ?? []).map((r) => (
                <div key={r.id} className="rounded-xl border border-line bg-ink-925 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-paper">{r.name}</span>
                    {r.isSystem && <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] text-faintest">system</span>}
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-faintest">{r.description}</p>
                  <p className="mono mt-1.5 text-[10px] text-faintest">{r.permissions.length} permissions</p>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite a member" description="You'll receive a note confirming the invitation token was issued.">
        <InviteForm orgId={orgId} roles={rolesApi.data?.roles ?? []} onDone={() => setInviteOpen(false)} />
      </Modal>
    </div>
  );
}

function InviteForm({
  orgId,
  roles,
  onDone,
}: {
  orgId: string;
  roles: RoleDetail[];
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { push } = useToast();

  const submit = async () => {
    if (!orgId || !email) return;
    setBusy(true);
    setError(null);
    try {
      await post(`/organizations/${orgId}/invitations`, { email, role });
      push({ kind: "success", title: "Invitation issued", message: "Token delivered by email." });
      push({ kind: "info", title: "Dev environment", message: "Check the developer mailbox for the acceptance token." });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invitation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Email address">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@firm.io" />
      </Field>
      <Field label="Role">
        <Select value={role} onChange={(e) => setRole(e.target.value)} options={roles.map((r) => ({ value: r.name, label: r.name }))} />
      </Field>
      {error && <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!email || busy}>Send invite</Button>
      </div>
    </div>
  );
}

interface Membership {
  id: string;
  organizationId: string;
  user: { id: string; email: string; emailVerified: boolean };
  role: { id: string; name: string; description: string | null; isSystem: boolean } | null;
  status: "ACTIVE" | "SUSPENDED";
  joinedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RoleDetail {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
}