import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

const SIZES = {
  xs: "size-3",
  sm: "size-4",
  md: "size-6",
  lg: "size-8",
  xl: "size-10",
} as const;

export interface SpinnerProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: keyof typeof SIZES;
  /** Accessible label announced to screen readers (default "Loading"). */
  label?: string;
}

/**
 * Circular loading indicator used app-wide in place of "…" text. Inline by
 * default (sits next to text in a button); pass a size for standalone use.
 */
export function Spinner({ size = "sm", label = "Loading", className, ...props }: SpinnerProps) {
  return (
    <span role="status" aria-live="polite" className={cn("inline-flex", className)} {...props}>
      <Loader2 className={cn("animate-spin text-current", SIZES[size])} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Centered spinner for filling a card/section/page region while data loads. */
export function SpinnerOverlay({
  label = "Loading",
  className,
  size = "lg",
}: {
  label?: string;
  className?: string;
  size?: keyof typeof SIZES;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground", className)}>
      <Spinner size={size} label={label} className="text-brand" />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}
