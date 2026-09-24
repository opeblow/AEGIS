"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight,
  Building2,
  Check,
  Handshake,
  MessageSquare,
  Send,
  X,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/hooks";
import { post } from "@/lib/api";
import { fmtDate, fmtMoney, timeAgo, uuid } from "@/lib/format";
import { humanLabel, toneFor } from "@/lib/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/data";
import { StatusChip, StatusDot } from "@/components/ui/badge";
import { Modal } from "@/components/ui/overlay";
import { Field, Input, Select } from "@/components/ui/inputs";
import { useToast } from "@/components/ui/toast";
import { Avatar, Empty, ErrorState, Loading } from "@/components/ui/atoms";
import type { PublicOffer, PublicRoomDeal, PublicDealParticipant } from "@/lib/types";

const CURRENCIES = ["USD", "EUR", "GBP", "CHF", "JPY", "SGD", "HKD", "AED"];

export default function DealRoom() {
  const params = useParams<{ dealId: string }>();
  const dealId = params.dealId;
  const { activeOrg } = useSession();
  const myOrgId = activeOrg?.organizationId ?? "";

  const room = useApi<{
    deal: PublicRoomDeal;
    participants: PublicDealParticipant[];
    total: number;
  }>(dealId ? `/deals/${dealId}/room` : null);
  const offers = useApi<{ offers: PublicOffer[]; total: number }>(
    dealId ? `/deals/${dealId}/offers` : null,
  );

  const deal = room.data?.deal;
  const participants = room.data?.participants ?? [];
  const list = offers.data?.offers ?? [];

  const [newOpen, setNewOpen] = useState(false);

  const myParticipant = participants.find((p) => p.organizationId === myOrgId);
  const counterpartOrg = participants.find((p) => p.organizationId !== myOrgId);
  const canOffer = !!myParticipant && myParticipant.status === "ACTIVE" && deal
    ? ["OPEN", "NEGOTIATING"].includes(deal.status)
    : false;

  if (room.loading) return <Loading rows={8} />;
  if (room.error || !deal)
    return <ErrorState message={room.error ?? "Room unavailable."} onRetry={room.reload} />;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        {/* Offer thread */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <CardHeader
              title="Negotiation thread"
              subtitle="Offers are immutable once submitted"
              icon={<ArrowLeftRight className="size-4 text-faint" />}
            />
            {canOffer && (
              <Button
                size="sm"
                icon={<Send className="size-4" />}
                onClick={() => setNewOpen(true)}
              >
                New offer
              </Button>
            )}
          </div>

          {offers.loading ? (
            <Loading rows={4} />
          ) : list.length === 0 ? (
            <Empty
              title="No offers yet"
              message="Send the first offer to open the negotiation."
              icon={<MessageSquare className="size-5" />}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {list.map((o) => (
                <OfferRow key={o.id} offer={o} myOrgId={myOrgId} dealId={dealId} onChanged={offers.reload} />
              ))}
            </div>
          )}
        </div>

        {/* Participants */}
        <Card>
          <CardHeader
            title="Parties"
            subtitle={`${participants.length} in the room`}
            icon={<Building2 className="size-4 text-faint" />}
          />
          <div className="divide-y divide-line">
            {participants.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={p.organization.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-paper">{p.organization.name}</p>
                    <p className="text-[11px] text-faintest">
                      {p.participantType === "OWNER" ? "Owner" : p.participantType.toLowerCase()}
                    </p>
                  </div>
                </div>
                <StatusDot tone={p.status === "ACTIVE" ? "success" : "faintest"} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New offer"
        description={
          counterpartOrg
            ? `Terms below go to ${counterpartOrg.organization.name}.`
            : "Waiting for counterparty participation."
        }
      >
        <NewOfferForm
          dealId={dealId}
          participants={participants}
          myOrgId={myOrgId}
          deal={deal}
          onDone={() => {
            setNewOpen(false);
            offers.reload();
          }}
        />
      </Modal>
    </div>
  );
}

function OfferRow({
  offer,
  myOrgId,
  dealId,
  onChanged,
}: {
  offer: PublicOffer;
  myOrgId: string;
  dealId: string;
  onChanged: () => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState<"counter" | "accept" | "reject" | "withdraw" | null>(null);

  const mine = offer.createdByOrganizationId === myOrgId;
  const actionable =
    offer.status === "SUBMITTED" &&
    offer.recipientOrganizationId === myOrgId;

  const act = async (kind: "accept" | "reject" | "withdraw" | "counter") => {
    setBusy(kind);
    try {
      const body = { version: offer.version, requestId: uuid() };
      const res = await post<{ offer?: PublicOffer }>(
        `/deals/${dealId}/offers/${offer.id}/${kind}`,
        body,
      );
      push({
        kind: "success",
        title: `${kind.charAt(0).toUpperCase() + kind.slice(1)} recorded`,
        message: res.offer ? `${fmtMoney(res.offer.amount, res.offer.currency)}` : undefined,
      });
      onChanged();
    } catch (e) {
      push({ kind: "error", title: "Action failed", message: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      className={`rounded-2xl border p-4 ${
        mine ? "border-line bg-ink-925" : "border-line bg-ink-900"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {mine ? (
            <Send className="size-4 text-accent-strong" />
          ) : (
            <ArrowLeftRight className="size-4 text-steel" />
          )}
          <div>
            <p className="text-sm text-paper">
              {mine ? "You offered" : `${offer.createdByOrganizationName} offered`}
            </p>
            <p className="text-xs text-faintest">
              {offer.direction === "sent" ? "to " : "from "}
              {(offer.direction === "sent" ? offer.recipientOrganizationName : offer.createdByOrganizationName)}
            </p>
          </div>
        </div>
        <StatusChip
          label={humanLabel(offer.status)}
          tone={toneFor.offer(offer.status)}
          size="xs"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-2xl font-semibold tabular text-paper">
            {fmtMoney(offer.amount, offer.currency)}
          </span>
          {offer.price && (
            <span className="mono text-sm text-faint">@{offer.price}</span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-[11px] text-faintest">
          <span>v{offer.version} · {timeAgo(offer.createdAt)}</span>
          {offer.expiresAt && <span>expires {fmtDate(offer.expiresAt)}</span>}
        </div>
      </div>

      {actionable && (
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            variant="success"
            icon={<Check className="size-4" />}
            loading={busy === "accept"}
            onClick={() => act("accept")}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<X className="size-4" />}
            loading={busy === "reject"}
            onClick={() => act("reject")}
          >
            Reject
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Handshake className="size-4" />}
            loading={busy === "counter"}
            onClick={() => act("counter")}
          >
            Counter
          </Button>
        </div>
      )}
    </div>
  );
}

function NewOfferForm({
  dealId,
  participants,
  myOrgId,
  deal,
  onDone,
}: {
  dealId: string;
  participants: PublicDealParticipant[];
  myOrgId: string;
  deal: PublicRoomDeal;
  onDone: () => void;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currency, setCurrency] = useState(deal.currency);
  const [amount, setAmount] = useState(deal.notionalAmount ?? "");
  const [price, setPrice] = useState("");
  const [settlementDate, setSettlementDate] = useState(deal.settlementDate ?? "");

  const recipient = participants.find((p) => p.organizationId !== myOrgId);

  const submit = async () => {
    if (!recipient || !amount) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ offer: PublicOffer }>(`/deals/${dealId}/offers`, {
        currency,
        amount,
        price: price || undefined,
        settlementDate: settlementDate ? new Date(settlementDate).toISOString() : undefined,
        recipientParticipantId: recipient.id,
        idempotencyKey: uuid(),
      });
      push({ kind: "success", title: "Offer drafted", message: `${fmtMoney(res.offer.amount, res.offer.currency)}` });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create offer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Currency">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Amount">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Reference price (optional)">
          <Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 1.0000" />
        </Field>
        <Field label="Settlement date">
          <Input type="date" value={settlementDate.split("T")[0]} onChange={(e) => setSettlementDate(e.target.value)} />
        </Field>
      </div>
      {error && <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone()}>Cancel</Button>
        <Button onClick={submit} loading={busy} disabled={!recipient || !amount || busy}>
          Create offer
        </Button>
      </div>
    </div>
  );
}