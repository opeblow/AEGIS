"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";

function useEscape(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
}

interface OverlayProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  className?: string;
  width?: "sm" | "md" | "lg" | "xl";
}

const widths = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
};

function Backdrop({ children, className, width }: { children: ReactNode; className?: string; width: keyof typeof widths }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/70 p-4 backdrop-blur-sm sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "animate-scale-in relative w-full rounded-xl border border-line-strong bg-ink-900 shadow-2xl",
          widths[width],
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  className,
  width = "md",
}: OverlayProps) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <Backdrop width={width} className={className}>
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        {title ? (
          <div className="min-w-0">
            <div className="text-sm font-semibold text-paper">{title}</div>
            {description && <p className="mt-0.5 text-xs text-faint">{description}</p>}
          </div>
        ) : (
          <span />
        )}
        <IconButton variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </IconButton>
      </div>
      <div className="max-h-[80vh] overflow-y-auto p-5">{children}</div>
    </Backdrop>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right",
  width = "26rem",
}: Pick<OverlayProps, "open" | "onClose" | "title" | "children"> & {
  side?: "right" | "left";
  width?: string;
}) {
  useEscape(onClose, open);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-ink-950/70 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "animate-fade-in absolute inset-y-0 flex flex-col border-line-strong bg-ink-900 shadow-2xl",
          side === "right" ? "right-0 border-l" : "left-0 border-r",
          width,
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          {title ? (
            <div className="text-sm font-semibold text-paper">{title}</div>
          ) : (
            <span />
          )}
          <IconButton variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}