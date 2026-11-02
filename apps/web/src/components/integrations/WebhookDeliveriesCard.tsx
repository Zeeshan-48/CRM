import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, RefreshCw, Send, XCircle } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listWebhookDeliveries,
  replayWebhookDelivery,
  type WebhookDelivery,
} from "@/lib/api/integrations";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<string, string> = {
  SUCCEEDED: "text-emerald-700 dark:text-emerald-300",
  PENDING: "text-sky-700 dark:text-sky-300",
  SENDING: "text-sky-700 dark:text-sky-300",
  FAILED: "text-amber-700 dark:text-amber-300",
  EXHAUSTED: "text-red-700 dark:text-red-300",
};

const STATUS_LABEL: Record<string, string> = {
  SUCCEEDED: "Delivered",
  PENDING: "Queued",
  SENDING: "Sending",
  FAILED: "Retrying",
  EXHAUSTED: "Gave up",
};

/**
 * A delivery that failed goes back to PENDING with the error recorded and a
 * retry scheduled, so the raw status alone would label it "Queued" and make a
 * broken endpoint look identical to one that simply has not been sent yet.
 */
const hasProblem = (d: WebhookDelivery): boolean =>
  d.status === "EXHAUSTED" || (!!d.error && d.attempt > 0 && d.status !== "SUCCEEDED");

const labelFor = (d: WebhookDelivery): string =>
  d.status === "PENDING" && hasProblem(d) ? "Retrying" : (STATUS_LABEL[d.status] ?? d.status);

const toneFor = (d: WebhookDelivery): string =>
  d.status === "PENDING" && hasProblem(d) ? STATUS_TONE.FAILED : STATUS_TONE[d.status];

const pretty = (payload: unknown): string => {
  const value = typeof payload === "string" ? safeParse(payload) : payload;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(payload);
  }
};

const safeParse = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

function DeliveryRow({ delivery }: { delivery: WebhookDelivery }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);

  const replay = useMutation({
    mutationFn: () => replayWebhookDelivery(delivery.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] });
      toast.success("Queued for another attempt");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const failed = hasProblem(delivery);

  return (
    <li className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left"
      >
        {delivery.status === "SUCCEEDED" ? (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
        ) : failed ? (
          <XCircle className="size-4 shrink-0 text-red-600 dark:text-red-400" />
        ) : (
          <Send className="size-4 shrink-0 text-muted-foreground" />
        )}

        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{delivery.event}</code>

        <Badge variant="outline" className={cn("text-[10px]", toneFor(delivery))}>
          {labelFor(delivery)}
        </Badge>

        {delivery.response_code ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            HTTP {delivery.response_code}
          </span>
        ) : null}

        {delivery.attempt > 1 ? (
          <span className="text-xs text-muted-foreground">attempt {delivery.attempt}</span>
        ) : null}

        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {timeAgo(delivery.created_at)}
        </span>
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div className="space-y-3 border-t px-3 py-3">
          {delivery.error ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <p className="text-xs font-medium text-red-700 dark:text-red-300">What went wrong</p>
              <p className="mt-0.5 break-words text-xs text-muted-foreground">{delivery.error}</p>
            </div>
          ) : null}

          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">What we sent</p>
            <pre className="max-h-56 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
              {pretty(delivery.payload)}
            </pre>
          </div>

          {delivery.response_body ? (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">What came back</p>
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">
                {delivery.response_body}
              </pre>
            </div>
          ) : null}

          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={replay.isPending}
            onClick={() => replay.mutate()}
          >
            <RefreshCw className="size-3.5" />
            Send it again
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Every outbound attempt, with its payload, the response and the error.
 *
 * Without this, debugging a webhook is guesswork on both sides: the receiving
 * team says nothing arrived and nobody can show them what was actually sent.
 */
export function WebhookDeliveriesCard() {
  const [failedOnly, setFailedOnly] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["webhook-deliveries"],
    queryFn: () => listWebhookDeliveries(),
    placeholderData: (previous) => previous,
  });

  // Filtered here rather than server-side on status=EXHAUSTED, which hid the
  // deliveries that are failing RIGHT NOW (they sit at PENDING between retries)
  // and showed only the ones we had already given up on.
  const all = data ?? [];
  const deliveries = failedOnly ? all.filter(hasProblem) : all;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Send className="size-4" />
            Outbound deliveries
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Every event this CRM sent to your webhooks, and what came back.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={failedOnly ? "secondary" : "outline"}
          onClick={() => setFailedOnly((v) => !v)}
        >
          {failedOnly ? "Showing problems" : "Problems only"}
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading && !data ? (
          <Skeleton className="h-24 w-full" />
        ) : deliveries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {failedOnly
              ? "Nothing failing. Good."
              : "Nothing sent yet. Add a webhook above and deliveries will show up here."}
          </p>
        ) : (
          <ul className="space-y-2">
            {deliveries.map((delivery) => (
              <DeliveryRow key={delivery.id} delivery={delivery} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
