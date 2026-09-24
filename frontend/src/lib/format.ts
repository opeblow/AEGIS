/** Formatting helpers. Money is parsed from decimal strings — no floats. */

const codeCache = new Map<string, Intl.NumberFormat>();

function nf(currency: string): Intl.NumberFormat {
  let fmt = codeCache.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    codeCache.set(currency, fmt);
  }
  return fmt;
}

/** Format a string money amount. Returns `—` when unset. */
export function fmtMoney(
  amount: string | number | null | undefined,
  currency: string,
  opts: { compact?: boolean; sign?: boolean } = {},
): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  if (opts.compact) {
    return `${opts.sign && n > 0 ? "+" : ""}${formatCompact(n)}${
      currency ? ` ${currency}` : ""
    }`;
  }
  return `${opts.sign && n > 0 ? "+" : ""}${nf(currency).format(n)}`;
}

/** Compact number, e.g. 1.2M. */
export function formatCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** ISO timestamp -> short local (`Sep 12, 09:41`). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/** ISO timestamp -> full local (`Sep 12, 2026 09:41:32`). */
export function fmtDateFull(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

/** ISO timestamp -> date-only (`Sep 12, 2026`). */
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

let relCache: Intl.RelativeTimeFormat | null = null;
function rel(): Intl.RelativeTimeFormat {
  if (!relCache) relCache = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  return relCache;
}

/** Relative time: "12m ago", "in 3d", "just now". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const seconds = Math.round(abs / 1000);
  if (seconds < 45) return diff >= 0 ? "in a moment" : "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rel().format(diff >= 0 ? minutes : -minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 48) return rel().format(diff >= 0 ? hours : -hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 30) return rel().format(diff >= 0 ? days : -days, "day");
  return fmtDay(iso);
}

/** Relative time that ticks: returns a new string each `intervalMs`. */
export function useTimeAgo(iso: string | null | undefined, intervalMs = 30_000): string {
  const tick = useTick(intervalMs);
  void tick;
  return timeAgo(iso);
}

import { useSyncExternalStore } from "react";
/** Re-render on an interval (modulo reduced-motion — reverts to static). */
export function useTick(intervalMs: number): number {
  return useSyncExternalStore(
    (cb) => {
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return () => {};
      const id = window.setInterval(cb, intervalMs);
      return () => window.clearInterval(id);
    },
    () => Date.now(),
    () => Date.now(),
  );
}

/** Shorten a 64-char hash to `ab12…cd34`. */
export function fmtHash(hash: string | null | undefined, head = 8, tail = 4): string {
  if (!hash) return "—";
  if (hash.length <= head + 1 + tail) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Filesize bytes -> readable. */
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 0..1 confidence -> percentage. */
export function fmtPct(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) return "—";
  return `${Math.round(fraction * 100)}%`;
}

/** First letter of a name, for avatars. */
export function initialsOf(name: string | null | undefined, fallback = "?"): string {
  if (!name) return fallback;
  return name.trim().slice(0, 1).toUpperCase();
}

export const uuid = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (cc) => {
    const r = (Math.random() * 16) | 0;
    const v = cc === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};