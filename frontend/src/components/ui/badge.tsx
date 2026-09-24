"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { toneFrom, type Tone } from "@/lib/status";

interface BadgeProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  pulse?: boolean;
}

/** Small status label. `dot` renders a leading indicator disc. */
export function Badge({ tone = "neutral", children, className, dot, pulse }: BadgeProps) {
  const t = toneFrom(tone);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap",
        t.chip,
        className,
      )}
    >
      {dot && (
        <span className="relative flex size-1.5">
          {pulse && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-40" />
          )}
          <span className="relative inline-flex size-1.5 rounded-full bg-current" />
        </span>
      )}
      <span className="tabular tracking-tight">{children}</span>
    </span>
  );
}

export function StatusDot({ tone = "neutral", className }: { tone?: Tone; className?: string }) {
  const t = toneFrom(tone);
  return (
    <span
      className={cn("inline-block size-1.5 shrink-0 rounded-full", t.color, className)}
      style={{ backgroundColor: t.color }}
    />
  );
}

/** The one component used for every domain status. */
export function StatusChip({
  label,
  tone,
  dot = true,
  size,
  pulse,
  className,
}: {
  label: string;
  tone: Tone;
  dot?: boolean;
  size?: "sm" | "xs";
  pulse?: boolean;
  className?: string;
}) {
  return (
    <Badge tone={tone} dot={dot} pulse={pulse} className={cn(size === "xs" && "h-5 px-2 text-[10px]", className)}>
      {label}
    </Badge>
  );
}

/** Thin progress bar 0..1 with a tone. */
export function Progress({
  value,
  tone = "accent",
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const t = toneFrom(tone);
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className={cn("h-1 w-full overflow-hidden rounded-full bg-ink-800", className)}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${clamped * 100}%`, backgroundColor: t.color }}
      />
    </div>
  );
}