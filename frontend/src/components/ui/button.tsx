"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "link" | "accent-solid";
type Size = "sm" | "md" | "lg" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

const base =
  "focus-ring inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-90";

const variants: Record<Variant, string> = {
  primary:
    "bg-paper text-ink-950 hover:bg-white active:bg-muted",
  "accent-solid": "bg-accent-strong text-accent-ink hover:bg-accent active:bg-accent-deep",
  secondary:
    "border border-line-strong bg-ink-850 text-paper hover:border-muted/30 hover:bg-ink-800",
  ghost: "text-muted hover:bg-ink-800 hover:text-paper",
  danger: "border border-rose/30 bg-rose-soft text-rose hover:bg-rose/20",
  success: "border border-accent/30 bg-accent-soft text-accent-strong hover:bg-accent/20",
  link: "text-accent hover:text-accent-strong underline-offset-4 hover:underline",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8.5 px-3.5 text-sm",
  lg: "h-10 px-4 text-sm",
  icon: "h-8.5 w-8.5",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant = "primary", size = "md", loading, icon, children, disabled, ...props },
    ref,
  ) => (
    <button
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

export const IconButton = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "icon", children, ...props }, ref) => (
    <Button ref={ref} variant={variant} size={size} className={cn(className)} {...props}>
      {children}
    </Button>
  ),
);
IconButton.displayName = "IconButton";

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
