"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Gavel,
  Landmark,
  Orbit,
  ShieldCheck,
  Wallet,
  Zap,
  Repeat2,
  Droplets,
  TrendingUp,
  BarChart3,
  Lock,
  Globe,
  CheckCircle2,
  Target,
  Layers,
  ChevronRight,
} from "lucide-react";
import { useSession, SessionProvider } from "@/lib/session";

export default function LandingPage() {
  return (
    <SessionProvider>
      <Landing />
    </SessionProvider>
  );
}

function Landing() {
  const { user, loading } = useSession();
  const cta = !loading && user ? "/app" : "/auth/sign-in";

  const capabilities = [
    {
      icon: Landmark,
      title: "Multi-party deal rooms",
      body: "Owners and counter-parties negotiate inside one sealed, versioned room. Every offer, document and requirement is immutable history — never a chat log.",
    },
    {
      icon: Gavel,
      title: "Policy-driven approvals",
      body: "Approval workflows are computed from your org's policies — notional thresholds, deal types, roles — and every decision is written to the ledger with a reason.",
    },
    {
      icon: Wallet,
      title: "Verifiable settlement",
      body: "Settlement is a provider-verified state, never a click. Aegis shows you what the Canton ledger actually says — matched amounts, references and reconciliation.",
    },
    {
      icon: ShieldCheck,
      title: "Security & audit",
      body: "Every transition carries an actor, a reason, and a request id. The security-event log is the single source of truth for who did what, when.",
    },
  ];

  const pillars = [
    "Institutional-grade typing — no free-form status strings",
    "Server-side authorization on every read and write",
    "Session + CSRF protection on every mutation",
    "Idempotency keys on every create path",
    "Advisory AI is strictly separated from authoritative state",
  ];

  const cannonFeatures = [
    {
      icon: Target,
      title: "Precision deal targeting",
      body: "Cannon's multi-dimensional scoring engine evaluates counterparty fitness across jurisdiction, risk appetite, and capital structure — surfacing the right match before you send the first offer.",
    },
    {
      icon: Layers,
      title: "Deal structuring intelligence",
      body: "From term sheets to final settlement conditions, Cannon structures complex multi-leg transactions with AI-generated clause suggestions grounded in your organisation's historical playbook.",
    },
    {
      icon: BarChart3,
      title: "Quantum-optimised portfolios",
      body: "Powered by our Quantum Optimization engine, Cannon solves portfolio-level allocation problems in milliseconds — selecting routes, amounts and counterparties with mathematically verifiable outcomes.",
    },
    {
      icon: Zap,
      title: "Instant deal intelligence",
      body: "Every deal surface exposes a one-click AI analysis: confidence scores, risk flags, document findings and model summaries — all strictly advisory, never mutating authoritative state.",
    },
  ];

  const oneswapFeatures = [
    {
      icon: Repeat2,
      title: "Atomic cross-asset swaps",
      body: "Initiate settlement-grade token swaps directly from within a deal room. OneSwap routing handles cross-chain complexity; Aegis writes the verified swap event to your ledger.",
    },
    {
      icon: Droplets,
      title: "Liquidity provisioning",
      body: "LP positions are tracked as first-class deal objects. Monitor depth, fee accrual and impermanent loss against your deal's settlement obligations — all in one audited view.",
    },
    {
      icon: TrendingUp,
      title: "Real-time market depth",
      body: "Live price quotes, slippage estimates and pool depth analytics are surfaced inside every deal. No tab switching; no stale data.",
    },
    {
      icon: Globe,
      title: "Multi-chain settlement",
      body: "OneSwap's router spans Ethereum, Arbitrum, Base and beyond. Aegis normalises the resulting settlement reference into a single verifiable state your compliance team can read.",
    },
  ];

  const stats = [
    { label: "Deal types supported", value: "12+" },
    { label: "Settlement providers", value: "Canton · Mock" },
    { label: "Avg. settlement latency", value: "< 4 s" },
    { label: "Audit events captured", value: "100%" },
  ];

  return (
    <div className="relative min-h-screen">
      {/* Background gradients and edge networks from the hero reference. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[800px] -translate-x-1/2 rounded-full bg-accent/5 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[400px] w-[400px] rounded-full bg-accent-strong/4 blur-[100px]" />
        <div className="absolute bottom-1/4 -left-40 h-[400px] w-[400px] rounded-full bg-steel/3 blur-[100px]" />
        <svg className="absolute -right-16 top-14 hidden h-[390px] w-[430px] opacity-[0.12] md:block" viewBox="0 0 430 390" fill="none" aria-hidden="true">
          <g stroke="#667383" strokeWidth="1"><path d="M25 12 130 88l84-16 83 64 94-28M130 88l3 73 81-89 55 106 28-42 94-28M133 161l-65 33 80 29 66-45 55 17 72 93M148 223l-39 106 105-73 91-7 36 64m-193-57 105 0-11-153M214 72 306 4m-1 132 28 152"/></g><g fill="#8895a5"><circle cx="25" cy="12" r="4"/><circle cx="130" cy="88" r="5"/><circle cx="214" cy="72" r="4"/><circle cx="297" cy="136" r="5"/><circle cx="391" cy="108" r="4"/><circle cx="133" cy="161" r="3"/><circle cx="68" cy="194" r="6"/><circle cx="148" cy="223" r="4"/><circle cx="269" cy="178" r="4"/><circle cx="306" cy="4" r="3"/><circle cx="294" cy="329" r="4"/><circle cx="335" cy="293" r="5"/></g>
        </svg>
        <svg className="absolute -left-24 bottom-12 hidden h-[300px] w-[420px] opacity-[0.10] md:block" viewBox="0 0 420 300" fill="none" aria-hidden="true">
          <g stroke="#667383" strokeWidth="1"><path d="m0 20 88 63 73-44 73 57 74-77 112 68M88 83l-49 85 112 7 10-136m0 136 99-79 48 87 112-9M39 168l78 89 34-82 84 85 89-114 47 27"/></g><g fill="#8895a5"><circle cx="88" cy="83" r="5"/><circle cx="161" cy="39" r="4"/><circle cx="234" cy="96" r="5"/><circle cx="308" cy="19" r="4"/><circle cx="39" cy="168" r="5"/><circle cx="151" cy="175" r="4"/><circle cx="250" cy="96" r="3"/><circle cx="298" cy="183" r="5"/><circle cx="117" cy="257" r="4"/><circle cx="201" cy="260" r="5"/></g>
        </svg>
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6">
        {/* Header */}
        <header className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
              <Orbit className="size-4 text-accent" />
            </span>
            <span className="text-base font-semibold tracking-tight text-paper">Aegis</span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <a href="#capabilities" className="hidden text-muted transition-colors hover:text-paper sm:block">Capabilities</a>
            <a href="#cannon" className="hidden text-muted transition-colors hover:text-paper sm:block">Cannon</a>
            <a href="#oneswap" className="hidden text-muted transition-colors hover:text-paper sm:block">OneSwap</a>
            <a href="#ledger" className="hidden text-muted transition-colors hover:text-paper sm:block">Ledger</a>
            <Link
              href={cta}
              id="nav-sign-in"
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent/50 bg-accent-soft px-4 text-sm font-semibold text-accent transition-all hover:bg-accent hover:text-accent-ink"
            >
              {!loading && user ? "Open dashboard" : "Sign in"}
              <ArrowRight className="size-3.5" />
            </Link>
          </nav>
        </header>

        {/* Hero */}
        <main className="flex flex-1 flex-col items-center pb-24 pt-12 text-center sm:pt-16">
          <div className="inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent-soft/50 px-3.5 py-1.5 text-xs font-medium text-accent">
            <span className="size-1.5 rounded-full bg-accent animate-pulse-soft" />
            Now with OneSwap liquidity integration
          </div>

          <h1 className="mt-5 max-w-4xl text-5xl font-semibold leading-[1.06] tracking-tight text-paper sm:text-6xl lg:text-7xl">
            Deals that settle on<br />
            <span className="bg-gradient-to-r from-accent to-steel bg-clip-text text-transparent">verifiable state.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            Aegis runs negotiation, approval, settlement and liquidity as one
            audited transaction record — written for institutions that cannot
            afford a dashboard that lies.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/auth/sign-up"
              id="hero-request-access"
              className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-7 text-sm font-semibold text-accent-ink transition-all hover:bg-accent-strong hover:shadow-lg hover:shadow-accent/20"
            >
              Request access
              <ArrowRight className="size-4" />
            </Link>
            <Link
              href="/app"
              id="hero-explore-app"
              className="focus-ring inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong px-7 text-sm font-medium text-paper transition-all hover:bg-ink-850 hover:border-accent/30"
            >
              Explore the app
              <ChevronRight className="size-4" />
            </Link>
          </div>

          {/* Labelled isometric deal flow illustration, positioned directly beneath the hero actions. */}
          <div className="relative mt-10 w-full max-w-[760px] sm:mt-12" aria-label="Aegis deal flow from negotiation through approval and settlement to the audited record">
            <svg className="h-auto w-full overflow-visible" viewBox="0 0 760 250" role="img" aria-labelledby="deal-flow-title">
              <title id="deal-flow-title">Negotiation, approval, settlement, liquidity, and audited record flow</title>
              <defs>
                <linearGradient id="flow-a" x1="180" y1="90" x2="600" y2="190" gradientUnits="userSpaceOnUse"><stop stopColor="#38d9c0" stopOpacity=".18"/><stop offset=".48" stopColor="#70bff3" stopOpacity=".62"/><stop offset="1" stopColor="#44d6bd" stopOpacity=".72"/></linearGradient>
                <linearGradient id="screen" x1="40" y1="95" x2="204" y2="174" gradientUnits="userSpaceOnUse"><stop stopColor="#f1f5f9"/><stop offset="1" stopColor="#aab7c7"/></linearGradient>
                <linearGradient id="cube" x1="583" y1="72" x2="685" y2="183" gradientUnits="userSpaceOnUse"><stop stopColor="#d1e6ec"/><stop offset=".48" stopColor="#7194a7"/><stop offset="1" stopColor="#344c61"/></linearGradient>
                <filter id="glow"><feGaussianBlur stdDeviation="5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
              </defs>
              <g fill="none" stroke="url(#flow-a)" strokeWidth="2.2" opacity=".86"><path d="M190 130C250 130 250 91 303 91s54 20 92 20 44-22 83-22 51 30 103 30"/><path d="M190 149c67 0 77 62 135 62s62-52 118-52 59 23 91 23 50-45 87-45"/><path d="M191 159c71 3 82 74 143 74s66-54 120-54 63 16 93 9 47-51 74-52"/><path d="M191 119c56 0 75-40 123-40s54 18 85 18 54-19 84-19 57 37 97 37" opacity=".38"/></g>
              <g fill="#49d9c6" filter="url(#glow)"><circle cx="247" cy="112" r="2.5"/><circle cx="354" cy="197" r="2"/><circle cx="470" cy="106" r="2.5"/><circle cx="541" cy="183" r="2"/><circle cx="608" cy="118" r="3"/></g>
              <path d="m24 130 124-62q7-4 14 0l64 32 2 59-117 59q-8 4-15 0l-72-38z" fill="#111923" stroke="#2a3949" strokeWidth="2"/><path d="m37 123 111-55q5-3 10 0l50 25-111 56q-6 3-12 0z" fill="#d8e0e8"/><path d="m85 149 111-56 2 47-110 57q-5 3-5-4z" fill="url(#screen)" stroke="#8797a7"/><path d="m97 153 17-9m-17 18 28-14m-28 24 19-10m-19 18 28-14m17-33 22-11m-22 20 34-17" stroke="#91a1b0" strokeWidth="2" opacity=".7"/><rect x="97" y="137" width="5" height="5" rx="1" fill="#37cfa7"/><rect x="169" y="103" width="11" height="5" rx="2.5" fill="#5cd5b7"/>
              <g><path d="m301 79 23-12 24 12-24 13z" fill="#627b8e"/><path d="m301 79 23 13v27l-23-13z" fill="#344b5d"/><path d="m324 92 24-13v27l-24 13z" fill="#496477"/><path d="m314 80 10-5 10 5-10 5z" fill="#a8c5d4"/><path d="m316 80 8-4 8 4-8 4z" fill="#68d9ca"/></g>
              <g><path d="m433 84 22-11 23 11-23 12z" fill="#667f91"/><path d="m433 84 22 12v24l-22-12z" fill="#354c5e"/><path d="m455 96 23-12v24l-23 12z" fill="#4b6578"/><path d="m446 85 9-5 10 5-10 5z" fill="#b6cbd5"/><path d="m448 85 7-4 8 4-8 4z" fill="#6fe0cc"/></g>
              <g><path d="m355 145 24-12 30 15-24 13z" fill="#91aabc"/><path d="m355 145 30 16v11l-30-16z" fill="#415b6d"/><path d="m385 161 24-13v11l-24 13z" fill="#587285"/><path d="m382 174 23-12 23 12-23 12z" fill="#bad0dc"/><path d="m382 174 23 12v10l-23-12z" fill="#466173"/><path d="m405 186 23-12v10l-23 12z" fill="#627e91"/></g>
              <g><path d="m455 195 22-11 23 12-22 12z" fill="#91aabc"/><path d="m455 196 23 12v22l-23-12z" fill="#3c5667"/><path d="m478 208 22-12v22l-22 12z" fill="#587487"/><path d="m466 199 12-6 12 6-12 6z" fill="#67dabd"/></g>
              <g><path d="m584 97 52-28 57 30-55 31z" fill="#c7d9e0"/><path d="m584 97 54 33v60l-54-31z" fill="#526f7e"/><path d="m638 130 55-31v60l-55 31z" fill="#344e61"/><path d="m598 97 38-20 42 22-40 22z" fill="#588f99"/><path d="m607 97 29-15 31 16-30 17z" fill="#5cddcb" opacity=".8"/><path d="m615 97 21-11 23 12-22 12z" fill="#a9eee2"/><path d="m614 136 14-8v24l-14 8z" fill="#8de9dd"/><path d="m646 143 14-8v24l-14 8z" fill="#a0ece2"/><path d="m618 140 6-4v12l-6 4zm32 7 6-4v12l-6 4z" fill="#397887"/><path d="m584 157 54 32 55-31" fill="none" stroke="#8fded5" strokeWidth="2"/></g>
              <g opacity=".9"><path d="m255 102 17-9 17 10-17 9z" fill="#628092"/><path d="m255 102 17 10v22l-17-10z" fill="#344b5c"/><path d="m272 112 17-9v22l-17 9z" fill="#4a6678"/><path d="m526 130 15-8 17 9-16 9z" fill="#7196a8"/><path d="m526 130 16 10v20l-16-10z" fill="#3a5868"/><path d="m542 140 16-9v20l-16 9z" fill="#4e7381"/></g>
              <g fill="#d6dee7" fontFamily="Arial, sans-serif" fontSize="12" textAnchor="middle"><text x="322" y="60">Approval</text><text x="455" y="66">Settlement</text><text x="399" y="155">Negotiation</text><text x="478" y="246">Liquidity</text><text x="646" y="213">Audited</text><text x="646" y="228">Record</text><text x="135" y="237">Negotiation</text></g><g fill="#69e0c5" opacity=".85"><circle cx="597" cy="52" r="1.5"/><circle cx="614" cy="43" r="1.5"/><circle cx="633" cy="57" r="1.5"/><circle cx="659" cy="45" r="1.5"/><circle cx="681" cy="59" r="1.5"/><circle cx="692" cy="75" r="1.5"/></g>
            </svg>
          </div>

          {/* Stats bar */}
          <div className="mt-8 grid w-full grid-cols-2 gap-3 sm:mt-12 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className="panel-raise flex flex-col items-center gap-1 px-4 py-5">
                <span className="text-xl font-bold tabular text-paper">{s.value}</span>
                <span className="text-xs text-faint">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Capabilities */}
          <div className="mt-20 w-full" id="capabilities">
            <p className="eyebrow">Core capabilities</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-paper">
              Built for institutional deal flow
            </h2>
            <div className="mt-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {capabilities.map((c) => (
                <div
                  key={c.title}
                  className="panel-raise group p-6 text-left transition-all hover:border-accent/20 hover:shadow-lg hover:shadow-accent/5"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg border border-accent/20 bg-accent-soft">
                    <c.icon className="size-4.5 text-accent" />
                  </div>
                  <h3 className="mt-4 text-sm font-semibold text-paper">{c.title}</h3>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Cannon Section */}
          <div className="mt-24 w-full" id="cannon">
            <div className="panel-raise overflow-hidden p-8 text-left">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="eyebrow text-amber">Cannon · Deal Intelligence Engine</p>
                  <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-paper">
                    From signal to signed — in one audited flow.
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
                    Cannon is Aegis&apos;s embedded intelligence layer: a quantum-optimised, AI-powered
                    engine that handles deal targeting, structuring and portfolio-level optimization —
                    while keeping every output strictly advisory and every state transition on the immutable ledger.
                  </p>
                  <Link
                    href="/app/deals"
                    className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-amber hover:text-amber-deep"
                  >
                    Open deal rooms <ArrowUpRight className="size-4" />
                  </Link>
                </div>
                <div className="flex items-center gap-2 rounded-xl border border-amber/20 bg-amber-soft/30 px-4 py-3">
                  <Zap className="size-5 text-amber" />
                  <span className="text-sm font-semibold text-amber">Quantum-accelerated</span>
                </div>
              </div>
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cannonFeatures.map((f) => (
                  <div key={f.title} className="rounded-xl border border-amber/10 bg-ink-900 p-5">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-amber/20 bg-amber-soft/50">
                      <f.icon className="size-4 text-amber" />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-paper">{f.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{f.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* OneSwap + Liquidity Section */}
          <div className="mt-8 w-full" id="oneswap">
            <div className="panel-raise overflow-hidden p-8 text-left">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="eyebrow text-steel">OneSwap × Aegis · Liquidity Integration</p>
                  <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-paper">
                    Settlement-grade liquidity,
                    <span className="text-steel"> inside the deal room.</span>
                  </h2>
                  <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
                    Aegis embeds OneSwap&apos;s cross-chain swap and liquidity provisioning engine
                    directly into the deal workflow. Get real-time quotes, initiate atomic swaps and
                    track LP positions — all written to the verifiable settlement ledger.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Link
                      href="/app/deals"
                      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg bg-steel/10 px-4 text-sm font-medium text-steel border border-steel/20 transition-all hover:bg-steel/20"
                    >
                      <Repeat2 className="size-4" />
                      Get a swap quote
                    </Link>
                    <Link
                      href="/app/deals"
                      className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg border border-line-strong px-4 text-sm font-medium text-muted transition-all hover:text-paper hover:bg-ink-850"
                    >
                      <Droplets className="size-4" />
                      Manage liquidity
                    </Link>
                  </div>
                </div>
                <div className="rounded-xl border border-steel/20 bg-steel-soft/30 p-5 text-left min-w-[220px]">
                  <p className="text-xs font-semibold uppercase tracking-wider text-steel/70">Live pool depth</p>
                  <p className="mt-2 text-2xl font-bold tabular text-paper">$2.4 B</p>
                  <p className="mt-0.5 text-xs text-faint">Aggregated across 6 chains</p>
                  <div className="mt-4 space-y-2">
                    {["ETH/USDC", "BTC/USDT", "ARB/ETH"].map((pair, i) => (
                      <div key={pair} className="flex items-center justify-between text-xs">
                        <span className="text-muted">{pair}</span>
                        <span className="font-medium text-steel">{["$812M", "$643M", "$289M"][i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {oneswapFeatures.map((f) => (
                  <div key={f.title} className="rounded-xl border border-steel/10 bg-ink-900 p-5">
                    <div className="flex size-8 items-center justify-center rounded-lg border border-steel/20 bg-steel-soft/50">
                      <f.icon className="size-4 text-steel" />
                    </div>
                    <h3 className="mt-3 text-sm font-semibold text-paper">{f.title}</h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted">{f.body}</p>
                  </div>
                ))}
              </div>

              {/* Integration flow diagram */}
              <div className="mt-8 rounded-xl border border-steel/10 bg-ink-900 p-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-faint mb-5">Integration flow</p>
                <div className="flex flex-wrap items-center gap-3">
                  {[
                    { label: "Deal room", icon: Landmark, color: "text-accent" },
                    { label: "OneSwap quote", icon: TrendingUp, color: "text-steel" },
                    { label: "Swap execution", icon: Repeat2, color: "text-steel" },
                    { label: "Quantum verify", icon: Zap, color: "text-amber" },
                    { label: "AI analysis", icon: BarChart3, color: "text-amber" },
                    { label: "Ledger write", icon: Lock, color: "text-accent" },
                    { label: "Settlement", icon: CheckCircle2, color: "text-accent" },
                  ].map((step, i, arr) => (
                    <div key={step.label} className="flex items-center gap-3">
                      <div className="flex flex-col items-center gap-1.5">
                        <div className={`flex size-8 items-center justify-center rounded-lg border border-line bg-ink-875`}>
                          <step.icon className={`size-3.5 ${step.color}`} />
                        </div>
                        <span className="text-[10px] text-faint whitespace-nowrap">{step.label}</span>
                      </div>
                      {i < arr.length - 1 && <ArrowRight className="size-3 text-faintest mb-3 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Ledger section */}
          <div id="ledger" className="panel-raise mt-8 w-full p-8 text-left">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <p className="eyebrow">The transaction record</p>
                <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight text-paper">
                  A ledger, not a spreadsheet.
                </h2>
                <ul className="mt-5 flex flex-col items-start gap-3">
                  {pillars.map((p) => (
                    <li key={p} className="flex items-center gap-3 text-sm text-muted">
                      <CheckCircle2 className="size-4 flex-shrink-0 text-accent" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-accent/15 bg-accent-soft/20 p-6 min-w-[220px]">
                <p className="text-xs font-semibold uppercase tracking-wider text-accent/60 mb-4">Ledger guarantees</p>
                <div className="space-y-3">
                  {["Immutable transitions", "Actor + reason on every event", "Idempotent mutations", "Verifiable settlement state"].map((g) => (
                    <div key={g} className="flex items-center gap-2.5 text-xs text-muted">
                      <span className="size-1.5 flex-shrink-0 rounded-full bg-accent-strong" />
                      {g}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* CTA Banner */}
          <div className="mt-8 w-full rounded-2xl border border-accent/20 bg-gradient-to-br from-accent-soft/60 to-steel-soft/20 p-12 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-paper">
              Ready to run your first deal?
            </h2>
            <p className="mt-3 text-sm text-muted max-w-lg mx-auto">
              Get access to Aegis&apos;s full deal infrastructure — Cannon, OneSwap, Quantum Optimization and the verifiable settlement ledger.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/auth/sign-up"
                id="cta-request-access"
                className="focus-ring inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-8 text-sm font-semibold text-accent-ink transition-all hover:bg-accent-strong hover:shadow-lg hover:shadow-accent/25"
              >
                Request access
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href={cta}
                id="cta-sign-in"
                className="focus-ring inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong px-8 text-sm font-medium text-paper transition-all hover:bg-ink-850"
              >
                {!loading && user ? "Open dashboard" : "Sign in"}
                <ChevronRight className="size-4" />
              </Link>
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="flex items-center justify-between border-t border-line py-6 text-xs text-faintest">
          <span className="flex items-center gap-2">
            <Orbit className="size-3.5 text-accent/50" />
            Aegis · verifiable settlement infrastructure
          </span>
          <span className="flex items-center gap-4">
            <span>OneSwap liquidity enabled</span>
            <span className="size-1 rounded-full bg-faintest" />
            <span>Quantum optimization active</span>
          </span>
        </footer>
      </div>
    </div>
  );
}
