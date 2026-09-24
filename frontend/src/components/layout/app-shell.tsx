"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChevronRight,
  Gavel,
  LayoutGrid,
  Orbit,
  Search,
  Settings,
  ShieldCheck,
  SquareKanban,
  LogOut,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useSession } from "@/lib/session";
import { CommandDialog, useCommandPalette, getAppCommands } from "@/components/ui/command";
import { Avatar, Kbd } from "@/components/ui/atoms";
import { CantonWalletChip } from "@/components/layout/canton-wallet-chip";

const nav = [
  { href: "/app", label: "Command Center", icon: LayoutGrid },
  { href: "/app/deals", label: "Deals", icon: SquareKanban },
  { href: "/app/approvals", label: "Approvals", icon: Gavel },
  { href: "/app/analytics", label: "Analytics", icon: Activity },
  { href: "/app/security", label: "Security & Verdicts", icon: ShieldCheck },
  { href: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useSession();
  const { open, setOpen } = useCommandPalette();
  const [mobileOpen, setMobileOpen] = useState(false);

  const commands = getAppCommands();

  return (
    <div className="relative isolate flex min-h-screen overflow-hidden">
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
        <div className="absolute -right-56 top-20 size-[560px] rounded-full bg-accent/3 blur-[130px]" />
        <svg className="absolute -right-24 top-16 hidden h-[380px] w-[420px] opacity-[0.06] xl:block" viewBox="0 0 420 380" fill="none"><g stroke="#8795a5"><path d="M20 20 120 82l78-45 92 72 92-35M120 82l5 105 73-150 48 130 44-58 92-35M125 187l-74 46 92 39 60-85 83 20 57 73M143 272l-30 83 108-76 93 7 40 51"/></g><g fill="#9eabb8"><circle cx="20" cy="20" r="4"/><circle cx="120" cy="82" r="5"/><circle cx="198" cy="37" r="4"/><circle cx="290" cy="109" r="5"/><circle cx="382" cy="74" r="4"/><circle cx="125" cy="187" r="4"/><circle cx="51" cy="233" r="5"/><circle cx="143" cy="272" r="4"/><circle cx="226" cy="187" r="4"/><circle cx="333" cy="280" r="5"/></g></svg>
      </div>
      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-14 flex-col border-r border-line bg-ink-900",
          "transition-transform lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link
          href="/app"
          className="focus-ring flex h-14 items-center justify-center border-b border-line"
          aria-label="Aegis home"
        >
          <Orbit className="size-5 text-accent" />
        </Link>
        <nav className="flex flex-1 flex-col items-center gap-1 py-3">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                aria-label={item.label}
                className={cn(
                  "focus-ring group relative flex size-9 items-center justify-center rounded-lg transition-colors",
                  active ? "bg-accent-soft text-accent" : "text-faint hover:bg-ink-850 hover:text-muted",
                )}
              >
                <item.icon className="size-4.5" />
                <span className="pointer-events-none absolute left-full z-50 ml-2 hidden whitespace-nowrap rounded-md border border-line-strong bg-ink-875 px-2 py-1 text-xs text-paper shadow-lg group-hover:block">
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>
        <div className="flex flex-col items-center gap-1 border-t border-line py-3">
          <button
            onClick={() => setOpen(true)}
            className="focus-ring flex size-9 items-center justify-center rounded-lg text-faint hover:bg-ink-850 hover:text-muted"
            aria-label="Command palette"
          >
            <Search className="size-4.5" />
          </button>
          {user && (
            <span className="flex size-9 items-center justify-center" title={user.email}>
              <Avatar name={user.name ?? user.email} size="md" />
            </span>
          )}
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink-950/60 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-line bg-ink-900/80 px-4 backdrop-blur-sm sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="focus-ring rounded-md p-1.5 text-muted hover:bg-ink-850 lg:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
            >
              <LayoutGrid className="size-4" />
            </button>
            <OrgSwitcher />
          </div>
          <div className="flex items-center gap-2">
            <CantonWalletChip />
            <button
              onClick={() => setOpen(true)}
              className="focus-ring flex h-8 items-center gap-2 rounded-lg border border-line bg-ink-925 px-3 text-xs text-faint transition-colors hover:border-line-strong hover:text-muted"
            >
              <Search className="size-3.5" />
              <span className="hidden sm:inline">Search and run commands</span>
              <span className="hidden items-center gap-1 sm:flex">
                <Kbd>^K</Kbd>
              </span>
            </button>
          </div>
        </header>

        <main className="relative z-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

        <footer className="flex min-w-0 items-center justify-between gap-3 border-t border-line px-4 py-3 text-[11px] text-faintest sm:px-6">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-accent-strong" />
            <span className="truncate">Aegis · verifiable settlement ledger</span>
          </span>
          <span className="mono max-w-[45%] truncate text-right">{user?.email ?? "—"}</span>
        </footer>
      </div>

      <CommandDialog open={open} setOpen={setOpen} commands={commands} />
    </div>
  );
}

function OrgSwitcher() {
  const { members, activeOrg, setActiveOrg, signOut } = useSession();
  const [open, setOpen] = useState(false);
  if (!activeOrg) return <div className="text-xs text-faintest">No organization</div>;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="focus-ring group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-ink-850"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Building2 className="size-4 text-faint" />
        <span className="text-sm font-medium text-paper">{activeOrg.organization?.name ?? "Aegis"}</span>
        <ChevronRight className={cn("size-3.5 text-faintest transition-transform", open && "rotate-90")} />
      </button>
      {open && (
        <div className="animate-scale-in absolute left-0 z-50 mt-1 w-64 rounded-xl border border-line-strong bg-ink-875 p-1 shadow-2xl">
          <p className="eyebrow px-2.5 py-1.5">Organizations</p>
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setActiveOrg(m);
                setOpen(false);
              }}
              className={cn(
                "focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                m.organizationId === activeOrg.organizationId ? "bg-accent-soft text-accent" : "text-muted hover:bg-ink-850",
              )}
            >
              <span className="flex-1 truncate">{m.organization?.name ?? "Unnamed"}</span>
              <span className="text-[10px] font-medium uppercase tracking-wider text-faintest">{m.role}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-line pt-1">
            <button
              onClick={() => void signOut()}
              className="focus-ring flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-rose hover:bg-rose-soft/50"
            >
              <LogOut className="size-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
