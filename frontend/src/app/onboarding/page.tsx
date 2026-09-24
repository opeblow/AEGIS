"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Orbit } from "lucide-react";
import { post } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/inputs";
import { SessionProvider, useSession } from "@/lib/session";

export default function OnboardingPage() {
  return (
    <SessionProvider>
      <OnboardingForm />
    </SessionProvider>
  );
}

function OnboardingForm() {
  const router = useRouter();
  const { refresh } = useSession();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [legalName, setLegalName] = useState("");
  const [country, setCountry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/organizations", {
        name,
        slug: slug || undefined,
        legalName: legalName || "",
        country: country || "",
      });
      await refresh();
      router.replace("/app");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create organization.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-12 lg:px-8">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-48 -top-40 size-[440px] rounded-full bg-accent/5 blur-[110px]" />
        <svg className="absolute -right-40 -top-32 h-[360px] w-[380px] opacity-[0.12]" viewBox="0 0 380 360" fill="none">
          <g stroke="#8795a5"><path d="M10 18 96 78l77-43 68 80 101-43M96 78l9 94 68-137 45 120 23-40 101-43M105 172l-72 39 76 40 64-79 60 21 48 68M109 251l-27 84 99-76 89 2 37 55"/></g>
          <g fill="#a4b2bf"><circle cx="10" cy="18" r="4"/><circle cx="96" cy="78" r="5"/><circle cx="173" cy="35" r="4"/><circle cx="241" cy="115" r="5"/><circle cx="342" cy="72" r="4"/><circle cx="105" cy="172" r="4"/><circle cx="33" cy="211" r="5"/><circle cx="109" cy="251" r="4"/><circle cx="173" cy="172" r="4"/><circle cx="282" cy="264" r="5"/></g>
        </svg>
        <svg className="absolute -bottom-24 -left-36 hidden h-[400px] w-[460px] opacity-[0.1] lg:block" viewBox="0 0 460 400" fill="none">
          <g stroke="#8795a5"><path d="m18 48 96 56 74-51 92 99 81-63 82 67M18 48l36 153 60-97 19 113 55-164 47 147 45-48 81 63 55 98M54 201l-33 94 112-78 44 87 84-50 90 74 65-129 63 48M21 295l156 9 42-50 128 74 70-77" /></g>
          <g fill="#a4b2bf"><circle cx="18" cy="48" r="5"/><circle cx="114" cy="104" r="5"/><circle cx="188" cy="53" r="4"/><circle cx="280" cy="152" r="5"/><circle cx="361" cy="89" r="4"/><circle cx="54" cy="201" r="5"/><circle cx="169" cy="267" r="4"/><circle cx="253" cy="217" r="5"/><circle cx="343" cy="291" r="5"/><circle cx="408" cy="162" r="4"/></g>
        </svg>
      </div>
      <div className="relative z-10 mx-auto flex w-full min-w-0 max-w-6xl flex-col items-center gap-10 lg:grid lg:grid-cols-[1fr_420px] lg:gap-16">
      <section className="hidden max-w-xl lg:block" aria-label="Aegis transaction flow">
        <p className="eyebrow text-accent">Aegis / transaction infrastructure</p>
        <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-paper xl:text-5xl">Start with a clear<br /><span className="bg-gradient-to-r from-accent to-steel bg-clip-text text-transparent">record of every deal.</span></h1>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">Set up your organization to bring negotiation, approval, settlement, and liquidity into one trusted transaction record.</p>
        <div className="panel-raise mt-9 overflow-hidden rounded-2xl p-4">
          <svg className="h-auto w-full" viewBox="0 0 520 220" role="img" aria-label="Deal flow from negotiation to approval, settlement, liquidity, and an audited record">
            <defs><linearGradient id="onboarding-flow" x1="38" y1="108" x2="480" y2="108" gradientUnits="userSpaceOnUse"><stop stopColor="#34d399" stopOpacity=".3"/><stop offset="1" stopColor="#7dd3fc" stopOpacity=".85"/></linearGradient></defs>
            <path d="M42 110c55 0 55-52 112-52s57 91 116 91 50-92 108-92 48 53 100 53" fill="none" stroke="url(#onboarding-flow)" strokeWidth="4"/><path d="M42 119c55 0 55 51 112 51s57-50 116-50 50 36 108 36 48-37 100-37" fill="none" stroke="url(#onboarding-flow)" strokeWidth="1.5" opacity=".55"/>
            <g fill="#16232a" stroke="#405969"><rect x="18" y="86" width="48" height="48" rx="12"/><rect x="133" y="39" width="42" height="42" rx="11"/><rect x="250" y="128" width="42" height="42" rx="11"/><rect x="356" y="36" width="46" height="46" rx="12"/><rect x="455" y="86" width="48" height="48" rx="12"/></g>
            <g fill="#6ce0bd"><circle cx="42" cy="110" r="6"/><circle cx="154" cy="60" r="6"/><circle cx="271" cy="149" r="6"/><circle cx="379" cy="59" r="6"/><circle cx="479" cy="110" r="6"/></g>
            <g fill="#bbc7d1" fontFamily="Arial,sans-serif" fontSize="11" textAnchor="middle"><text x="42" y="158">Negotiate</text><text x="154" y="99">Approve</text><text x="271" y="191">Settle</text><text x="379" y="100">Liquidity</text><text x="479" y="158">Audit</text></g>
          </svg>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-faint"><span className="rounded-full border border-line px-3 py-1.5">Private deal rooms</span><span className="rounded-full border border-line px-3 py-1.5">Policy-based approvals</span><span className="rounded-full border border-line px-3 py-1.5">Auditable settlement</span></div>
      </section>
      <section className="mx-auto w-full min-w-0 max-w-md lg:max-w-none">
      <Link href="/" className="mb-7 flex items-center justify-center gap-2.5 lg:justify-start">
        <span className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft"><Orbit className="size-4 text-accent" /></span>
        <span className="text-base font-semibold tracking-tight text-paper">Aegis</span>
      </Link>
      <div className="panel-raise w-full p-6 sm:p-8">
      <p className="eyebrow">Onboarding</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-paper">
        Name your organization
      </h1>
      <p className="mt-1.5 text-sm text-muted">
        The organization is your deal-operating entity. Counterparties, deals
        and approvals all live inside one organization.
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Organization name">
          <Input
            placeholder="Meridian Capital Ltd."
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Slug" hint="Used in references and API paths. Auto-derived when blank.">
          <Input
            placeholder="meridian-capital"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Legal name">
            <Input
              placeholder="Legal entity name"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
            />
          </Field>
          <Field label="Country">
            <Select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              options={[
                { value: "", label: "Select…" },
                { value: "United States", label: "United States" },
                { value: "United Kingdom", label: "United Kingdom" },
                { value: "Switzerland", label: "Switzerland" },
                { value: "Germany", label: "Germany" },
                { value: "France", label: "France" },
                { value: "Singapore", label: "Singapore" },
                { value: "Hong Kong", label: "Hong Kong" },
                { value: "Japan", label: "Japan" },
                { value: "UAE", label: "UAE" },
              ]}
            />
          </Field>
        </div>

        {error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">
            {error}
          </p>
        )}

        <Button type="submit" loading={busy} disabled={!name || busy} size="lg">
          Create organization
        </Button>
      </form>
      </div>
      </section>
      </div>
    </div>
  );
}
