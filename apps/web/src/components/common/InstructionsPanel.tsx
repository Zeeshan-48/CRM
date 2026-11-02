import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Renders a dashboard menu path as keyboard-cap style breadcrumb chips
 * (e.g. Settings › API Keys) instead of plain "->" arrow text.
 */
export function NavPath({ crumbs }: { crumbs: string[] }) {
  return (
    <span className="mx-0.5 inline-flex flex-wrap items-center gap-1 align-middle">
      {crumbs.map((crumb, i) => (
        <React.Fragment key={crumb}>
          {i > 0 ? (
            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
          ) : null}
          <span className="rounded bg-background px-1.5 py-px font-mono text-[11px] font-medium text-foreground ring-1 ring-inset ring-border">
            {crumb}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * Collapsible, numbered walkthrough panel shared by settings pages that need a
 * "how to set this up" guide. Steps are ReactNodes so callers can embed
 * <NavPath>, <strong> and <code> for a polished, readable walkthrough.
 */
export function InstructionsPanel({
  steps,
  title = "How to connect",
  icon: Icon = BookOpen,
  docHref,
  docLabel,
  accentClass = "bg-brand/10 text-brand",
  defaultOpen = true,
  className,
}: {
  steps: React.ReactNode[];
  title?: string;
  icon?: React.ComponentType<{ className?: string }>;
  docHref?: string;
  docLabel?: string;
  accentClass?: string;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn("group rounded-xl border bg-muted/30", className)}
    >
      <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          {title}
        </span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
      </summary>
      <div className="border-t px-4 py-4">
        <ol className="space-y-3.5">
          {steps.map((step, i) => (
            <li key={i} className="flex gap-3">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  accentClass,
                )}
              >
                {i + 1}
              </span>
              <div className="text-sm leading-relaxed text-muted-foreground [&_code]:rounded [&_code]:bg-background [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-foreground [&_strong]:font-medium [&_strong]:text-foreground">
                {step}
              </div>
            </li>
          ))}
        </ol>
        {docHref ? (
          <a
            href={docHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-brand transition-colors hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {docLabel ?? "Open dashboard"}
          </a>
        ) : null}
      </div>
    </details>
  );
}
