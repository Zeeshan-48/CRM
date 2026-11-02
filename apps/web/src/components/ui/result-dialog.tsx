import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type ResultVariant = "success" | "error";

export interface ResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant: ResultVariant;
  title: string;
  description?: React.ReactNode;
  /** Primary button label. Defaults to "Done". */
  actionLabel?: string;
  /** Runs before the dialog closes when the button is pressed. */
  onAction?: () => void;
  /**
   * Auto-dismiss after this many milliseconds. Omit to require a manual close,
   * the sensible default for errors, which the user should read.
   */
  autoCloseMs?: number;
}

/**
 * A small, reusable confirmation dialog for the outcome of an action. Shows an
 * animated tick (success) or cross (error) that draws itself in, a short title
 * and message, and a single dismiss button. Drop it in anywhere:
 *
 *   <ResultDialog
 *     open={done !== null}
 *     onOpenChange={(o) => !o && setDone(null)}
 *     variant="success"
 *     title="Saved"
 *     description="Your changes are live."
 *     autoCloseMs={5000}
 *   />
 */
export function ResultDialog({
  open,
  onOpenChange,
  variant,
  title,
  description,
  actionLabel = "Done",
  onAction,
  autoCloseMs,
}: ResultDialogProps) {
  React.useEffect(() => {
    if (!open || !autoCloseMs) return;
    const t = window.setTimeout(() => onOpenChange(false), autoCloseMs);
    return () => window.clearTimeout(t);
  }, [open, autoCloseMs, onOpenChange]);

  const isError = variant === "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <div className="flex flex-col items-center py-3 text-center">
          <span
            // Re-key on each open so the pop + draw animation replays every time.
            key={open ? variant : "closed"}
            className={cn(
              "result-pop flex size-16 items-center justify-center rounded-full ring-8",
              isError
                ? "bg-danger/10 text-danger ring-danger/5"
                : "bg-success/10 text-success ring-success/5",
            )}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-8"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              {isError ? (
                <>
                  <path className="result-draw" pathLength={1} d="M7 7l10 10" />
                  <path
                    className="result-draw result-draw-late"
                    pathLength={1}
                    d="M17 7L7 17"
                  />
                </>
              ) : (
                <path className="result-draw" pathLength={1} d="M5 13l4 4L19 7" />
              )}
            </svg>
          </span>

          <DialogTitle className="mt-4 text-lg">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="mt-1">{description}</DialogDescription>
          ) : null}

          <Button
            variant={isError ? "outline" : "default"}
            className="mt-5 w-full"
            onClick={() => {
              onAction?.();
              onOpenChange(false);
            }}
          >
            {actionLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
