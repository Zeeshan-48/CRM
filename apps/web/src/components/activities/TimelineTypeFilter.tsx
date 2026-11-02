import { cn } from "@/lib/utils";

export interface TimelineFilterOption {
  value: string;
  label: string;
  count: number;
}

/**
 * The row of type-filter chips shown above a record's timeline / activity feed
 * (lead, contact and deal). Presentational only: each host computes the options
 * from its own data (by activity type, channel, or interaction kind) and owns
 * the selected value + filtering. "ALL" is the reset value. Hidden entirely when
 * there's only one type present, since a filter would then be pointless.
 */
export function TimelineTypeFilter({
  options,
  total,
  value,
  onChange,
  className,
}: {
  options: TimelineFilterOption[];
  total: number;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  if (options.length < 2) return null;

  const chipClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium transition-colors duration-120",
      active
        ? "border-brand/40 bg-brand/10 text-brand"
        : "border-border text-muted-foreground hover:bg-muted",
    );

  return (
    <div className={cn("mb-4 flex flex-wrap gap-1.5", className)}>
      <button
        type="button"
        onClick={() => onChange("ALL")}
        className={chipClass(value === "ALL")}
      >
        All
        <span className="tabular-nums opacity-70">{total}</span>
      </button>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={chipClass(value === opt.value)}
        >
          {opt.label}
          <span className="tabular-nums opacity-70">{opt.count}</span>
        </button>
      ))}
    </div>
  );
}
