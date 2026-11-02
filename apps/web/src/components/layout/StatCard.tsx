import type { LucideIcon } from "lucide-react";
import * as React from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  hint?: string;
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
          <Spinner size="sm" className="text-muted-foreground" />
        ) : (
          <p className="font-display text-[28px] font-semibold leading-none tabular-nums tracking-tight">
            {value}
          </p>
        )}
      </div>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
