"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface TabsCtx {
  active: string;
  setActive: (id: string) => void;
}

const TabsCtx = createContext<TabsCtx | null>(null);

export function Tabs({
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: {
  defaultValue?: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}) {
  const [internal, setInternal] = useState<string>(defaultValue ?? "");
  const active = value ?? internal;
  const setActive = (id: string) => {
    if (value === undefined) setInternal(id);
    onValueChange?.(id);
  };
  return (
    <TabsCtx.Provider value={{ active, setActive }}>
      <div className={className}>{children}</div>
    </TabsCtx.Provider>
  );
}

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-0.5 rounded-lg border border-line bg-ink-925 p-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TabsTrigger({
  value,
  children,
  icon,
}: {
  value: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabsTrigger must be used within Tabs");
  const active = ctx.active === value;
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => ctx.setActive(value)}
      className={cn(
        "focus-ring flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
        active ? "bg-ink-800 text-paper shadow-sm" : "text-faint hover:text-muted",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function TabsContent({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  const ctx = useContext(TabsCtx);
  if (!ctx) throw new Error("TabsContent must be used within Tabs");
  if (ctx.active !== value) return null;
  return <div className={cn("animate-fade-in", className)}>{children}</div>;
}