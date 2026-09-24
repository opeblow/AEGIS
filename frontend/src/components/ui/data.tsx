"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ *
 * Panel / card primitives
 * ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  raised,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div className={cn(raised ? "panel-raise" : "panel", "overflow-hidden", className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  right,
  icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  right?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-line px-4 py-3.5", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <div className="mt-0.5 shrink-0 text-muted">{icon}</div>}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-tight text-paper">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
        </div>
      </div>
      {(action ?? right) && <div className="shrink-0">{action ?? right}</div>}
    </div>
  );
}

export function CardBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3.5", className)}>{children}</div>;
}

/* ------------------------------------------------------------------ *
 * Definition list (label / value pairs)
 * ------------------------------------------------------------------ */

export function Row({
  label,
  value,
  mono,
  className,
  hint,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  className?: string;
  hint?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-1.5", className)}>
      <dt className="shrink-0 text-xs text-faint">{label}</dt>
      <dd className={cn("text-right text-sm text-paper", mono && "mono tabular", hint && "text-muted")}
        title={hint ?? undefined}>
        {value}
      </dd>
    </div>
  );
}

export function KeyValues({
  children,
  values,
  className,
}: {
  children?: ReactNode;
  values?: [string, ReactNode][];
  className?: string;
}) {
  return (
    <dl className={cn("divide-y divide-line", className)}>
      {values
        ? values.map(([k, v]) => (
            <Row key={k} label={k} value={v} />
          ))
        : children}
    </dl>
  );
}

/* ------------------------------------------------------------------ *
 * Stat band
 * ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  delta,
  tone = "paper",
  hint,
  mono,
}: {
  label: string;
  value: ReactNode;
  delta?: string;
  tone?: "paper" | "accent" | "amber" | "rose" | "steel" | "neutral";
  hint?: string;
  mono?: boolean;
}) {
  const tones = {
    paper: "text-paper",
    accent: "text-accent",
    amber: "text-amber",
    rose: "text-rose",
    steel: "text-steel",
    neutral: "text-muted",
  };
  return (
    <div className="min-w-0">
      <p className="eyebrow truncate">{label}</p>
      <p className={cn("mt-1.5 truncate text-2xl font-semibold tracking-tight tabular", tones[tone], mono && "mono")}>
        {value}
      </p>
      {delta && <p className="mt-0.5 truncate text-xs text-faintest">{delta}</p>}
      {hint && <p className="mt-0.5 truncate text-xs text-faintest">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Table primitives
 * ------------------------------------------------------------------ */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="[&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[11px] [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-[0.08em] [&_th]:text-faintest">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="[&_tr:last-child]:border-0 [&_tr]:border-b [&_tr]:border-line/60">
      {children}
    </tbody>
  );
}

// NOTE: clients render row cells as plain <td className="px-3 py-2.5"> cells
// and use Tr for row hover + click hierarchy; both live in table-row helper
// below to keep the table abstraction minimal.

export function Tr({
  children,
  onClick,
  className,
  selected,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  selected?: boolean;
}) {
  return (
    <tr
      onClick={onClick}
      className={cn(
        "transition-colors",
        onClick && "cursor-pointer hover:bg-ink-850/60",
        selected && "bg-accent-soft/40",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function Td({
  children,
  className,
  mono,
  right,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
  right?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle",
        mono && "mono tabular",
        right && "text-right",
        className,
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ *
 * Divider / group label
 * ------------------------------------------------------------------ */

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-line", className)} />;
}

export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("eyebrow px-1 py-2", className)}>{children}</p>;
}