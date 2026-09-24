"use client";

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";
import { Check, ChevronDown } from "lucide-react";

const fieldBase =
  "focus-ring w-full rounded-lg border border-line bg-ink-925 px-3 text-sm text-paper placeholder:text-faintest transition-colors hover:border-line-strong focus:border-accent/50";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, mono, ...props }, ref) => (
    <input ref={ref} className={cn(fieldBase, "h-9", mono && "font-mono tabular", className)} {...props} />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(fieldBase, "min-h-20 py-2", className)} {...props} />
));
Textarea.displayName = "Textarea";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly { value: string; label: string }[];
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, options, placeholder, defaultValue, value, ...props }, ref) => {
    const hasValue = value !== undefined && String(value) !== "";
    return (
      <div className="relative">
        <select
          ref={ref}
          value={value}
          defaultValue={defaultValue}
          className={cn(
            fieldBase,
            "h-9 appearance-none pr-8",
            (hasValue || defaultValue !== undefined) && "text-paper",
            className,
          )}
          {...props}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-faint" />
      </div>
    );
  },
);
Select.displayName = "Select";

interface FieldProps {
  label?: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  suffix?: ReactNode;
}

export function Field({ label, hint, error, htmlFor, children, className, suffix }: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="flex items-center justify-between text-xs font-medium text-muted">
          <span>{label}</span>
          {suffix}
        </label>
      )}
      {children}
      {error && (
        <p className="flex items-center gap-1 text-xs text-rose">
          <span className="size-1 rounded-full bg-rose" />
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-faintest">{hint}</p>}
    </div>
  );
}

interface CheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
}

export function Checkbox({ label, className, checked, ...props }: CheckboxProps) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <span
        className={cn(
          "flex size-4.5 shrink-0 items-center justify-center rounded-[5px] border",
          checked ? "border-accent-strong bg-accent-strong" : "border-line-strong bg-ink-925",
        )}
      >
        {checked && <Check className="size-3 text-accent-ink" strokeWidth={3} />}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        {...props}
      />
      {label}
    </label>
  );
}