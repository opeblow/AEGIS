"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Kind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  message?: string;
}

interface ToastCtxValue {
  push: (t: Omit<ToastItem, "id">) => void;
}

const ToastCtx = createContext<ToastCtxValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      const ttl = t.kind === "error" ? 9000 : 5000;
      window.setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      {mounted &&
        createPortal(
          <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2">
            {toasts.map((t) => (
              <div
                key={t.id}
                className="animate-scale-in pointer-events-auto relative flex items-start gap-3 rounded-xl border border-line-strong bg-ink-850 p-3.5 shadow-2xl"
              >
                <ToastIcon kind={t.kind} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-paper">{t.title}</p>
                  {t.message && <p className="mt-0.5 text-xs text-muted">{t.message}</p>}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  className="focus-ring rounded p-1 text-faint hover:text-paper"
                  aria-label="Dismiss"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}

function ToastIcon({ kind }: { kind: Kind }) {
  if (kind === "success") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" />;
  if (kind === "error") return <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose" />;
  return <Info className="mt-0.5 size-4 shrink-0 text-steel" />;
}

export { cn };