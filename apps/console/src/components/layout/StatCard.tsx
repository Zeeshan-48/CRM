import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: React.ReactNode;
  loading?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** A metric as type on a hairline: small label over a large number. No tile. */
export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  loading = false,
  className,
  style,
}: StatCardProps) {
  return (
    <div className={cn("border-t pt-3", className)} style={style}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {Icon ? <Icon className="size-3.5 shrink-0" aria-hidden /> : null}
        {label}
      </p>
      <div className="mt-1 flex h-9 items-center">
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums tracking-tight">
            {value}
          </p>
        )}
      </div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
