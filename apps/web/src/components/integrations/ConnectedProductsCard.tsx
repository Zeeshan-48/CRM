import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleDot, Copy, Plug, Plus, Settings2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { ConnectedProductSheet } from "@/components/integrations/ConnectedProductSheet";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createAppKey,
  createConnectedApp,
  listConnectedApps,
  listEventDefinitions,
  type AppHealth,
  type ConnectedApp,
} from "@/lib/api/products";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasModule, useAuthStore } from "@/stores/auth-store";

const HEALTH_TONE: Record<AppHealth, string> = {
  OK: "text-emerald-700 dark:text-emerald-300",
  STALE: "text-amber-700 dark:text-amber-300",
  ERROR: "text-red-700 dark:text-red-300",
  PENDING: "text-slate-600 dark:text-slate-300",
};

const HEALTH_LABEL: Record<AppHealth, string> = {
  OK: "Receiving data",
  STALE: "Gone quiet",
  ERROR: "Error",
  PENDING: "Waiting for first event",
};

/** Shown exactly once, because the raw key is never retrievable again. */
function RevealedKey({ value, onDone }: { value: string; onDone: () => void }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="size-4" />
          Copy this now
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          This is the only time the key is shown. If you lose it, create another one.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button aria-label={copied ? "Copied" : "Copy"}
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              toast.error("Could not copy. Select the key and copy it manually.");
            }
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
      <Button type="button" className="w-full" onClick={onDone}>
        I have saved it
      </Button>
    </div>
  );
}

function CreateProductDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState("");
  const [productUrl, setProductUrl] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);

  const reset = () => {
    setName("");
    setProductUrl("");
    setDescription("");
    setRevealedKey(null);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const app = await createConnectedApp({
        name: name.trim(),
        product_url: productUrl.trim() || undefined,
        description: description.trim() || undefined,
        capabilities: { events: true, identity: true, catalog: true },
      });
      // Minting the first key immediately is the difference between "created a
      // record" and "ready to integrate". Nobody wants a second click here.
      const key = await createAppKey(app.id, { scope: "SECRET", name: `${app.name} server key` });
      return key.key;
    },
    onSuccess: (rawKey) => {
      void queryClient.invalidateQueries({ queryKey: ["connected-apps"] });
      setRevealedKey(rawKey);
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
          <DialogTitle>{revealedKey ? "Your API key" : "Connect a product"}</DialogTitle>
          <DialogDescription>
            {revealedKey
              ? "Use this key to send leads, events and your catalog to the CRM."
              : "Register the software product you want to wire into this CRM. You will get an API key straight away."}
          </DialogDescription>
        </DialogHeader>

        {revealedKey ? (
          <RevealedKey
            value={revealedKey}
            onDone={() => {
              reset();
              onOpenChange(false);
            }}
          />
        ) : (
          <>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="product-name">Product name</Label>
                <Input
                  id="product-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme Learning Platform"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-url">Product URL</Label>
                <Input
                  id="product-url"
                  value={productUrl}
                  onChange={(e) => setProductUrl(e.target.value)}
                  placeholder="https://app.acme.com"
                />
                <p className="text-xs text-muted-foreground">
                  Used to deep-link from a lead record back into your product.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-description">Description</Label>
                <Textarea
                  id="product-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this product is, so your team knows what they are looking at."
                  rows={2}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => mutation.mutate()}
                disabled={!name.trim() || mutation.isPending}
              >
                {mutation.isPending ? "Connecting..." : "Connect product"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One row per connected product. Everything editable lives behind Configure. */
function ProductRow({ app, onConfigure }: { app: ConnectedApp; onConfigure: () => void }) {
  // Only for the "needs review" nudge. The full registry is in the sheet.
  const { data: definitions } = useQuery({
    queryKey: ["event-definitions", app.id],
    queryFn: () => listEventDefinitions(app.id),
  });
  const pending = (definitions ?? []).filter((d) => d.review_status === "NEEDS_REVIEW").length;

  return (
    <div className="space-y-2 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{app.name}</span>
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {app.key}
        </code>
        {app.environment === "TEST" ? (
          <Badge variant="outline" className="text-[10px]">
            Test
          </Badge>
        ) : null}
        {app.status === "PAUSED" ? (
          <Badge variant="outline" className="text-[10px]">
            Paused
          </Badge>
        ) : null}
        <Badge variant="outline" className={cn("gap-1", HEALTH_TONE[app.health])}>
          {HEALTH_LABEL[app.health]}
        </Badge>

        <div className="ml-auto flex items-center gap-2">
          {app.last_event_at ? (
            <span className="text-xs text-muted-foreground">
              Last event {timeAgo(app.last_event_at)}
            </span>
          ) : null}
          <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={onConfigure}>
            <Settings2 className="size-3.5" />
            Configure
          </Button>
        </div>
      </div>

      {app.health_detail ? (
        <p className="text-xs text-muted-foreground">{app.health_detail}</p>
      ) : null}

      {pending > 0 ? (
        <button
          type="button"
          onClick={onConfigure}
          className="flex w-full items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-sm hover:bg-amber-500/10"
        >
          <CircleDot className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <span>
            {pending} new event{pending === 1 ? "" : "s"} to review
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            Stored, but not counted yet
          </span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * Connected products: the external systems wired into this workspace.
 *
 * Lives on the Integrations page beside the existing lead-capture and webhook
 * cards, because to an admin they are the same job.
 */
export function ConnectedProductsCard() {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [configuringId, setConfiguringId] = React.useState<string | null>(null);

  // The /products routes are module-gated, but this card lives on Integrations
  // which every workspace can open. Without the same gate it fetches on every
  // load and the backend 403s, leaving a card that reads "no products
  // connected" when the truth is the module was never granted.
  const user = useAuthStore((s) => s.user);
  const canUseProducts = hasModule(user, "products");

  const { data, isLoading } = useQuery({
    queryKey: ["connected-apps"],
    queryFn: listConnectedApps,
    enabled: canUseProducts,
  });

  const apps = data ?? [];

  if (!canUseProducts) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4" />
            Connected products
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Software products that send leads, activity and their catalog into this CRM.
          </p>
        </div>
        <Button type="button" size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Plus className="size-4" />
          Connect
        </Button>
      </CardHeader>

      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : apps.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <Plug className="mx-auto size-5 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No products connected yet. Connect one to give your agents live pricing,
              offers and buyer intent on every lead.
            </p>
          </div>
        ) : (
          apps.map((app) => (
            <ProductRow key={app.id} app={app} onConfigure={() => setConfiguringId(app.id)} />
          ))
        )}
      </CardContent>

      <CreateProductDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConnectedProductSheet
        appId={configuringId}
        onOpenChange={(open) => {
          if (!open) setConfiguringId(null);
        }}
      />
    </Card>
  );
}
