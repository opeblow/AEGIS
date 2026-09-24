"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Orbit } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthGate>{children}</AuthGate>
    </SessionProvider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse-soft flex items-center gap-2 text-sm text-faintest">
          <span className="size-1.5 rounded-full bg-accent" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-40 -top-44 size-[560px] rounded-full bg-accent/5 blur-[130px]" />
        <div className="absolute -bottom-56 -left-44 size-[500px] rounded-full bg-steel/5 blur-[120px]" />
        <svg className="absolute -right-12 top-12 hidden h-[420px] w-[440px] opacity-[0.13] lg:block" viewBox="0 0 440 420" fill="none">
          <g stroke="#8795a5" strokeWidth="1"><path d="M20 22 112 86l96-52 77 86 99-39M112 86l17 112 79-164 37 155 40-69 99-39M129 198l-88 46 97 47 70-93 77 24 61 89M138 291l-35 87 112-82 89 6 49 68M208 34l77-52m-40 207 40 98"/></g><g fill="#a4b2bf"><circle cx="20" cy="22" r="4"/><circle cx="112" cy="86" r="5"/><circle cx="208" cy="34" r="4"/><circle cx="285" cy="120" r="5"/><circle cx="384" cy="81" r="4"/><circle cx="129" cy="198" r="4"/><circle cx="41" cy="244" r="6"/><circle cx="138" cy="291" r="4"/><circle cx="274" cy="222" r="4"/><circle cx="103" cy="378" r="4"/><circle cx="344" cy="350" r="5"/></g>
        </svg>
      </div>
      <Link href="/" className="focus-ring absolute left-5 top-5 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-faint transition-colors hover:text-muted">
        <ChevronLeft className="size-4" /> Back
      </Link>
      <div className="mx-auto flex min-h-screen w-full min-w-0 max-w-6xl flex-1 flex-col items-center gap-12 px-5 py-24 lg:grid lg:grid-cols-[1fr_420px] lg:px-10">
        <section className="relative hidden max-w-xl lg:block" aria-label="Aegis transaction flow">
          <p className="eyebrow text-accent">Aegis / transaction infrastructure</p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-paper xl:text-5xl">Every decision<br /><span className="bg-gradient-to-r from-accent to-steel bg-clip-text text-transparent">leaves a trail.</span></h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">Bring negotiation, approvals, settlement, and liquidity into one verifiable record built for institutional deal flow.</p>
          <div className="panel-raise mt-9 overflow-hidden p-4">
            <svg className="h-auto w-full" viewBox="0 0 520 180" role="img" aria-label="A deal moves from negotiation through approval and settlement into an audited record">
              <defs><linearGradient id="auth-flow" x1="44" y1="96" x2="474" y2="90" gradientUnits="userSpaceOnUse"><stop stopColor="#34d399" stopOpacity=".3"/><stop offset="1" stopColor="#7dd3fc" stopOpacity=".85"/></linearGradient></defs>
              <path d="M46 96C105 96 100 54 167 54s66 73 126 73 49-78 106-78 46 47 78 47" fill="none" stroke="url(#auth-flow)" strokeWidth="3"/><path d="M46 105c65 0 67 49 122 49s73-52 128-52 51 31 103 31 45-38 78-38" fill="none" stroke="url(#auth-flow)" strokeWidth="1.5" opacity=".6"/>
              <g fill="#16232a" stroke="#405969"><rect x="25" y="76" width="48" height="42" rx="10"/><rect x="151" y="36" width="40" height="36" rx="9"/><rect x="275" y="109" width="42" height="36" rx="9"/><rect x="382" y="30" width="44" height="38" rx="9"/><rect x="465" y="76" width="44" height="42" rx="10"/></g>
              <g fill="#6ce0bd"><circle cx="49" cy="97" r="5"/><circle cx="171" cy="54" r="5"/><circle cx="296" cy="127" r="5"/><circle cx="404" cy="49" r="5"/><circle cx="487" cy="97" r="5"/></g>
              <g fill="#bbc7d1" fontFamily="Arial,sans-serif" fontSize="10" textAnchor="middle"><text x="49" y="137">Negotiate</text><text x="171" y="89">Approve</text><text x="296" y="163">Settle</text><text x="404" y="85">Verify</text><text x="487" y="137">Record</text></g>
            </svg>
          </div>
          <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-faint">
            <span className="rounded-full border border-line px-3 py-1.5">Versioned deal rooms</span><span className="rounded-full border border-line px-3 py-1.5">Policy-based approvals</span><span className="rounded-full border border-line px-3 py-1.5">Auditable settlement</span>
          </div>
        </section>
        <section className="mx-auto w-full min-w-0 max-w-sm lg:max-w-none">
          <Link href="/" className="mb-7 flex items-center justify-center gap-2.5 lg:justify-start">
            <span className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft"><Orbit className="size-4 text-accent" /></span>
            <span className="text-base font-semibold tracking-tight text-paper">Aegis</span>
          </Link>
          <div className="panel-raise rounded-2xl p-6 sm:p-8">{children}</div>
          <p className="mt-4 text-center text-[11px] text-faintest">Secure access to your organization&apos;s transaction record</p>
        </section>
      </div>
    </div>
  );
}
