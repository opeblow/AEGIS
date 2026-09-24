"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { initialsOf } from "@/lib/format";
import { toneFrom, type Tone } from "@/lib/status";

/* ------------------------------------------------------------------ *
 * Small shared atoms: Avatar, Kbd, Tooltip, Empty/Error/Loading states
 * ------------------------------------------------------------------ */

export function Avatar({
  name,
  tone = "neutral",
  size = "md",
  className,
}: {
  name: string | null | undefined;
  tone?: Tone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const t = toneFrom(tone);
  const sizes = { sm: "size-5 text-[10px]", md: "size-7 text-xs", lg: "size-9 text-sm" };
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-semibold uppercase",
        sizes[size],
        t.softBg,
        t.textStrong,
        className,
      )}
    >
      {initialsOf(name ?? "A")}
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-ink-850 px-1.5 font-mono text-[10px] font-medium text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md border border-line-strong bg-ink-800 px-2 py-1 text-[11px] whitespace-nowrap text-paper opacity-0 shadow-xl transition-opacity duration-100 group-hover/tt:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

export function Empty({
  title,
  message,
  icon,
  action,
  className,
}: {
  title: string;
  message?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && <div className="mb-1 text-faintest">{icon}</div>}
      <p className="text-sm font-medium text-muted">{title}</p>
      {message && <p className="max-w-sm text-xs text-faintest">{message}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-10 rounded-lg" />
      ))}
    </div>
  );
}

export function ErrorState({
  title = "Could not load this data",
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-lg border border-rose/20 bg-rose-soft/40 px-4 py-3", className)}>
      <p className="text-sm font-medium text-rose">{title}</p>
      {message && <p className="text-xs text-muted">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="focus-ring mt-1 rounded-md border border-line-strong bg-ink-850 px-2.5 py-1 text-xs text-muted transition-colors hover:text-paper"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/** Status-like empty pill used before a value exists. */
export function Muted({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-faintest", className)}>{children}</span>;
}