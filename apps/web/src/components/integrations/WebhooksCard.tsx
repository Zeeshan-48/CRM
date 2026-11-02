import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Plus, Radio, Trash2, Zap } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createWebhook,
  deleteWebhook,
  listWebhooks,
  testWebhook,
  type Webhook,
} from "@/lib/api/integrations";
import { timeAgo } from "@/lib/format";

/** Plain-English label for each event a product can subscribe to. */
const EVENT_LABEL: Record<string, string> = {
  "lead.created": "A lead is captured",
  "lead.converted": "A lead becomes a contact",
  "lead.stage_changed": "A lead moves stage",
  "deal.stage_changed": "A deal moves stage",
  "deal.won": "A deal is won",
  "ticket.created": "A ticket is opened",
  "payment.success": "A payment succeeds",
  "meeting.scheduled": "A meeting is booked",
  "product.high_intent": "Someone shows strong buying intent",
  "product.checkout_abandoned": "Someone abandons checkout",
};

function CreateWebhookDialog({
  events,
  open,
  onOpenChange,
}: {
  events: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [event, setEvent] = React.useState(events[0] ?? "lead.created");
  const [secret, setSecret] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const reset = () => {
    setUrl("");
    setSecret(null);
    setCopied(false);
  };

  const mutation = useMutation({
    mutationFn: () => createWebhook({ url: url.trim(), event }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      // The signing secret is shown exactly once, on creation.
      setSecret(created.secret);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{secret ? "Your signing secret" : "Send events to your product"}</DialogTitle>
          <DialogDescription>
            {secret
              ? "Verify every delivery against this secret before trusting it."
              : "The CRM will POST to your endpoint whenever this happens."}
          </DialogDescription>
        </DialogHeader>

        {secret ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="size-4" />
                Copy this now
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This is the only time it is shown. Delete the webhook and create another
                if you lose it.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                {secret}
              </code>
              <Button aria-label={copied ? "Copied" : "Copy secret"}
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(secret);
                    setCopied(true);
                  } catch {
                    toast.error("Could not copy. Select it and copy manually.");
                  }
                }}
              >
                {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
            >
              I have saved it
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="webhookscard-when-this-happens">When this happens</Label>
                <Select value={event} onValueChange={setEvent}>
                  <SelectTrigger id="webhookscard-when-this-happens">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((e) => (
                      <SelectItem key={e} value={e}>
                        {EVENT_LABEL[e] ?? e}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wh-url">Send it here</Label>
                <Input
                  id="wh-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://your-app.example.com/hooks/crm"
                />
                <p className="text-xs text-muted-foreground">
                  Must be https and publicly reachable. Failed deliveries retry for six
                  hours, then stop.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={!url.trim() || mutation.isPending}>
                {mutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WebhookRow({ webhook }: { webhook: Webhook }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const test = useMutation({
    mutationFn: () => testWebhook(webhook.id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] });
      // A real signed request now goes out, so report what actually came back
      // rather than the old placeholder that always claimed success.
      if (result.ok) {
        toast.success(`Delivered, your endpoint returned ${result.delivery.response_code}`);
      } else {
        toast.error(result.delivery.error ?? `Failed with ${result.delivery.response_code ?? "no response"}`);
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteWebhook(webhook.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["webhooks"] });
      toast.success("Webhook deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <li className="flex flex-wrap items-center gap-2 border-t pt-3">
      <Badge variant="outline" className="text-[10px]">
        {EVENT_LABEL[webhook.event] ?? webhook.event}
      </Badge>
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
        {webhook.url}
      </code>
      <span className="shrink-0 text-xs text-muted-foreground">
        {webhook.deliveries} sent
        {webhook.last_delivery_at ? ` · ${timeAgo(webhook.last_delivery_at)}` : ""}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="gap-1.5"
        disabled={test.isPending}
        onClick={() => test.mutate()}
      >
        <Zap className="size-3.5" />
        {test.isPending ? "Sending..." : "Test"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-muted-foreground hover:text-destructive"
        disabled={remove.isPending}
        aria-label="Delete webhook"
        onClick={async () => {
          const ok = await confirm({
            title: "Delete this webhook?",
            description: `The CRM will stop sending "${webhook.event}" to ${webhook.url}.`,
            destructive: true,
            confirmText: "Delete",
          });
          if (ok) remove.mutate();
        }}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

/**
 * Webhook subscriptions: the CRM telling your product what just happened.
 *
 * The backend has had these endpoints since the CRM was written, but nothing in
 * the UI ever called them, so the outbound half of the integration could not be
 * set up at all. The delivery log below this card was showing an empty state
 * that told people to "add a webhook above", pointing at a control that did not
 * exist.
 */
export function WebhooksCard() {
  const [open, setOpen] = React.useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["webhooks"], queryFn: listWebhooks });

  const webhooks = data?.webhooks ?? [];
  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Radio className="size-4" />
            Send events to your product
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            When something happens in the CRM, we POST it to your endpoint, signed so you
            can verify it came from us.
          </p>
        </div>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
          <Plus className="size-4" />
          Add webhook
        </Button>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : webhooks.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <Radio className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No webhooks yet. Add one so your product can react when a deal is won or a
              lead goes hot.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {webhooks.map((webhook) => (
              <WebhookRow key={webhook.id} webhook={webhook} />
            ))}
          </ul>
        )}
      </CardContent>

      <CreateWebhookDialog events={events} open={open} onOpenChange={setOpen} />
    </Card>
  );
}
