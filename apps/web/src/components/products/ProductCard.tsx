import { useState } from "react";
import { Check, Copy, ExternalLink, Package, Tag, Ticket } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Product } from "@/lib/api/products";
import { cn } from "@/lib/utils";

// "/ monthly" reads wrong next to a price. People say "per month".
const PERIOD_SUFFIX: Record<string, string> = {
  MONTHLY: "per month",
  QUARTERLY: "per quarter",
  YEARLY: "per year",
};

/**
 * Copy-to-clipboard with inline confirmation.
 *
 * Agents use this mid-call, so the confirmation has to be visible without
 * stealing focus or opening a toast they then have to dismiss.
 */
function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is blocked in some embedded contexts. Silently doing nothing
      // is better than an error toast for a nice-to-have.
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      className={cn("gap-1.5", className)}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * One catalog item as an agent needs it: what it is, what it costs right now,
 * what discount is live, and the exact words to pitch it with.
 */
export function ProductCard({
  product,
  onAttach,
}: {
  product: Product;
  onAttach?: (product: Product) => void;
}) {
  const price = product.price;
  const offer = product.best_offer;
  const thumbnail = product.media?.thumbnail ?? null;

  // The pitch block an agent copies wholesale into a message.
  const pitchText = [
    product.name,
    price ? `Price: ${price.amount_display}` : null,
    offer?.code ? `Use code ${offer.code} for ${offer.discount_display} off` : null,
    ...product.highlights.map((h) => `- ${h}`),
    product.url ?? null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-5">
        <div className="flex items-start gap-3">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              className="size-12 shrink-0 rounded-lg border object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex size-12 shrink-0 items-center justify-center rounded-lg border bg-muted">
              <Package className="size-5 text-muted-foreground" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold leading-tight">{product.name}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {product.category ? (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Tag className="size-2.5" />
                  {product.category}
                </Badge>
              ) : null}
              {product.app_name ? (
                <Badge variant="outline" className="text-[10px]">
                  {product.app_name}
                </Badge>
              ) : null}
              {product.source === "MANUAL" ? (
                <Badge variant="outline" className="text-[10px]">
                  CRM
                </Badge>
              ) : null}
            </div>
          </div>
        </div>

        {/* ---- Price ---- */}
        <div className="flex flex-wrap items-baseline gap-2">
          {price ? (
            <>
              <span className="text-xl font-semibold tabular-nums">{price.amount_display}</span>
              {price.compare_at_display ? (
                <span className="text-sm text-muted-foreground line-through">
                  {price.compare_at_display}
                </span>
              ) : null}
              {price.savings_percent > 0 ? (
                <Badge
                  variant="outline"
                  className="text-[10px] text-emerald-700 dark:text-emerald-300"
                >
                  {price.savings_percent}% off
                </Badge>
              ) : null}
              {price.billing_period !== "ONE_TIME" ? (
                <span className="text-xs text-muted-foreground">
                  {PERIOD_SUFFIX[price.billing_period] ?? ""}
                </span>
              ) : null}
            </>
          ) : (
            // Unpriced is not free, and saying so protects an agent from
            // quoting a number that does not exist.
            <span className="text-sm text-muted-foreground">No published price</span>
          )}
        </div>

        {/* ---- Live offer, with the code an agent can read out ---- */}
        {offer ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
            <Ticket className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {offer.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {offer.discount_display} off, now {offer.final_display}
            </span>
            {offer.days_left !== null ? (
              <span className="text-xs text-muted-foreground">
                {offer.days_left === 0 ? "ends today" : `${offer.days_left}d left`}
              </span>
            ) : null}
            {offer.code ? (
              <CopyButton value={offer.code} label={offer.code} className="ml-auto h-6 px-2 text-[11px]" />
            ) : null}
          </div>
        ) : null}

        {/* ---- The pitch bullets ---- */}
        {product.highlights.length > 0 ? (
          <ul className="space-y-1">
            {product.highlights.slice(0, 4).map((h) => (
              <li key={h} className="flex gap-1.5 text-sm text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-current opacity-50" />
                <span>{h}</span>
              </li>
            ))}
          </ul>
        ) : product.description ? (
          <p className="line-clamp-3 text-sm text-muted-foreground">{product.description}</p>
        ) : null}

        {/* ---- Actions ---- */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          <CopyButton value={pitchText} label="Copy pitch" />
          {product.url ? (
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={product.url} target="_blank" rel="noreferrer noopener">
                View <ExternalLink className="size-3.5" />
              </a>
            </Button>
          ) : null}
          {onAttach ? (
            <Button type="button" size="sm" onClick={() => onAttach(product)} className="ml-auto">
              Add to deal
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
