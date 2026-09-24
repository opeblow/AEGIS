"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  Building2,
  FileSearch,
  Gavel,
  Home,
  KeyRound,
  Landmark,
  Search,
  Settings,
  ShieldCheck,
  SquareKanban,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import { Kbd } from "./atoms";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  href?: string;
  action?: () => void;
  group: string;
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}

export function CommandDialog({
  open,
  setOpen,
  commands,
}: {
  open: boolean;
  setOpen: (o: boolean) => void;
  commands: Command[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        (c.group || "").toLowerCase().includes(q) ||
        (c.hint || "").toLowerCase().includes(q),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const cmd = filtered[index];
        if (cmd) {
          if (cmd.href) router.push(cmd.href);
          cmd.action?.();
          setOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, index, filtered]);

  const groups = useMemo(() => {
    const g = new Map<string, Command[]>();
    for (const c of filtered) {
      const list = g.get(c.group) ?? [];
      list.push(c);
      g.set(c.group, list);
    }
    return [...g.entries()];
  }, [filtered]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[14vh]">
      <div
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="animate-scale-in relative w-full max-w-xl overflow-hidden rounded-xl border border-line-strong bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="size-4 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="Type a command or search…"
            className="w-full bg-transparent text-sm text-paper outline-none placeholder:text-faintest"
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="max-h-[42vh] overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="px-3 py-8 text-center text-xs text-faintest">
              No matches for “{query}”
            </p>
          )}
          {groups.map(([group, cmds]) => (
            <div key={group} className="mb-1">
              <p className="eyebrow px-3 py-1.5">{group}</p>
              {cmds.map((c) => {
                const selected = c === filtered[index];
                return (
                  <button
                    key={c.id}
                    onMouseEnter={() =>
                      setIndex(filtered.findIndex((x) => x.id === c.id))
                    }
                    onClick={() => {
                      if (c.href) router.push(c.href);
                      c.action?.();
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                      selected ? "bg-accent-soft text-accent" : "text-muted",
                    )}
                  >
                    <span className="shrink-0">{c.icon}</span>
                    <span className="flex-1 truncate">{c.label}</span>
                    {c.hint && (
                      <span className="shrink-0 font-mono text-[10px] text-faintest">
                        {c.hint}
                      </span>
                    )}
                    <ArrowRight className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function getAppCommands(): Command[] {
  return [
    { id: "home", label: "Command Center", group: "Navigate", icon: <Home className="size-4" />, href: "/app" },
    { id: "deals", label: "Deals", group: "Navigate", icon: <SquareKanban className="size-4" />, href: "/app/deals" },
    { id: "approvals", label: "Approvals", group: "Navigate", icon: <Gavel className="size-4" />, href: "/app/approvals" },
    { id: "analytics", label: "Analytics", group: "Navigate", icon: <FileSearch className="size-4" />, href: "/app/analytics" },
    { id: "settings", label: "Settings", group: "Navigate", icon: <Settings className="size-4" />, href: "/app/settings" },
    { id: "verdict", label: "Security & Verdicts", group: "Navigate", icon: <ShieldCheck className="size-4" />, href: "/app/security" },
    { id: "new-deal", label: "New deal", group: "Actions", icon: <Landmark className="size-4" />, href: "/app/deals/new" },
    { id: "org", label: "Organization settings", group: "Actions", icon: <Building2 className="size-4" />, href: "/app/settings" },
    { id: "keys", label: "API credentials", group: "Actions", icon: <KeyRound className="size-4" />, href: "/app/settings" },
  ];
}