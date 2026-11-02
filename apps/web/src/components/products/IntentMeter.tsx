import { cn } from "@/lib/utils";
import type { IntentBand, IntentReason } from "@/lib/api/products";

/** Band styling. Kept as one map so the three bands never drift apart visually. */
const BAND_STYLE: Record<IntentBand, { bar: string; text: string; label: string }> = {
  HOT: {
    bar: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    label: "Hot",
  },
  WARM: {
    bar: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    label: "Warm",
  },
  COLD: {
    bar: "bg-slate-400",
    text: "text-slate-500 dark:text-slate-400",
    label: "Cold",
  },
};

/**
 * Product-intent score with the reasons behind it.
 *
 * The reasons are the point, not decoration. A bare number is something an agent
 * learns to distrust and then ignore; "Viewed pricing x6" and "Started checkout,
 * did not finish" are things they can open a call with.
 */
export function IntentMeter({
  score,
  band,
  reasons,
  compact = false,
}: {
  score: number;
  band: IntentBand;
  reasons: IntentReason[];
  compact?: boolean;
}) {
  const style = BAND_STYLE[band] ?? BAND_STYLE.COLD;

  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <div className="flex items-baseline gap-2">
        <span className={cn("text-2xl font-semibold tabular-nums leading-none", style.text)}>
          {score}
        </span>
        <span className="text-xs text-muted-foreground">/ 100</span>
        <span className={cn("ml-auto text-xs font-medium uppercase tracking-wide", style.text)}>
          {style.label}
        </span>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={score}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Product intent score ${score} of 100, ${style.label}`}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", style.bar)}
          style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
        />
      </div>

      {reasons.length > 0 ? (
        <ul className={cn("space-y-1", compact && "space-y-0.5")}>
          {reasons.slice(0, compact ? 2 : 4).map((reason) => (
            <li
              key={reason.label}
              className="flex items-center gap-1.5 text-xs text-muted-foreground"
            >
              <span className="size-1 shrink-0 rounded-full bg-current opacity-50" />
              <span className="truncate">{reason.label}</span>
              {reason.count > 1 ? (
                <span className="shrink-0 tabular-nums opacity-70">x{reason.count}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : score === 0 ? (
        // Only when there is genuinely nothing to explain. A caller that renders
        // the reasons itself passes an empty array with a real score, and this
        // used to contradict it: "81 / 100 Hot. Not enough activity to score."
        <p className="text-xs text-muted-foreground">
          Not enough product activity to score yet.
        </p>
      ) : null}
    </div>
  );
}
