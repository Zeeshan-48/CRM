import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

/** Quiet, unboxed empty state: an outline icon, a line of type and an action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "reveal flex flex-col items-center justify-center px-6 py-16 text-center",
        className
      )}
    >
      {Icon ? <Icon className="mb-4 size-7 text-muted-foreground" strokeWidth={1.5} aria-hidden /> : null}
      <h2 className="font-display text-base font-semibold tracking-tight">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
