"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/inputs";
import { Card, CardHeader, CardBody } from "@/components/ui/data";
import { useToast } from "@/components/ui/toast";
import { uuid } from "@/lib/format";
import type { PublicDeal, DealType } from "@/lib/types";

const types: { value: DealType; label: string; hint: string }[] = [
  { value: "RWA_PURCHASE", label: "RWA Purchase", hint: "Owned real-world asset acquisition" },
  { value: "RWA_SALE", label: "RWA Sale", hint: "Disposal of an owned real-world asset" },
  { value: "PRIVATE_TRADE", label: "Private Trade", hint: "Off-market bilateral transaction" },
  { value: "OTHER", label: "Other", hint: "Anything the type system should be extended for" },
];

const currencies = [
  { value: "USD", label: "USD — US Dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British Pound" },
  { value: "CHF", label: "CHF — Swiss Franc" },
  { value: "JPY", label: "JPY — Japanese Yen" },
  { value: "SGD", label: "SGD — Singapore Dollar" },
  { value: "HKD", label: "HKD — Hong Kong Dollar" },
  { value: "AED", label: "AED — UAE Dirham" },
];

export default function NewDealPage() {
  const router = useRouter();
  const { activeOrg } = useSession();
  const { push } = useToast();
  const orgId = activeOrg?.organizationId ?? "";

  const [type, setType] = useState<DealType | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [amount, setAmount] = useState("");
  const [settlementDate, setSettlementDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!orgId || !type || !name || !amount) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ deal: PublicDeal }>(
        `/organizations/${orgId}/deals`,
        {
          type,
          name,
          description: description || undefined,
          currency,
          notionalAmount: amount,
          settlementDate: settlementDate ? new Date(settlementDate).toISOString() : undefined,
          idempotencyKey: uuid(),
        },
      );
      push({ kind: "success", title: "Deal created", message: `${res.deal.name} · ${res.deal.reference}` });
      router.push(`/app/deals/${res.deal.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create deal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/app/deals" className="focus-ring -ml-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-faint hover:text-muted">
          <ArrowLeft className="size-4" />
          Deals
        </Link>
        <p className="eyebrow mt-3">New deal</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">
          Open a negotiation room
        </h1>
        <p className="mt-1.5 max-w-lg text-sm text-muted">
          A deal is born in <span className="text-paper">DRAFT</span>. Once you
          invite and verify a counterparty, you can open it for negotiation.
        </p>
      </div>

      <Card>
        <CardHeader title="Shared terms" subtitle="Everything on this card is written to the deal record as versioned history." />
        <CardBody className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Deal type">
              <Select value={type} onChange={(e) => setType(e.target.value as DealType)} placeholder="Select a type" options={types.map((t) => ({ value: t.value, label: t.label }))} />
            </Field>
            <Field label="Denominated currency">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)} options={currencies} />
            </Field>
          </div>
          <Field label="Deal name">
            <Input placeholder="e.g. Acme Warehouse Portfolio — Series B" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Description">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Purpose, structure, parties…" className="focus-ring w-full rounded-lg border border-line bg-ink-925 px-3 py-2 text-sm text-paper placeholder:text-faintest" rows={3} />
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Notional amount">
              <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1,250,000.00" inputMode="decimal" />
            </Field>
            <Field label="Target settlement date">
              <Input type="date" value={settlementDate} onChange={(e) => setSettlementDate(e.target.value)} />
            </Field>
          </div>

          {error && (
            <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">{error}</p>
          )}

          <div className="flex items-center justify-between border-t border-line pt-4">
            <p className="text-xs text-faintest">Idempotency key generated client-side.</p>
            <Button onClick={submit} loading={busy} disabled={!type || !name || !amount || busy}>
              Create deal
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}