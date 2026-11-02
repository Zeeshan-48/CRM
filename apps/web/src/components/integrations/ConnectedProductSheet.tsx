import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, KeyRound, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { ProductSetupGuide } from "@/components/integrations/ProductSetupGuide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createAppKey,
  deleteConnectedApp,
  getConnectedApp,
  listEventDefinitions,
  rotateActionsSecret,
  updateConnectedApp,
  updateEventDefinition,
  type EventDefinition,
} from "@/lib/api/products";
import { timeAgo } from "@/lib/format";

/** Shown exactly once: neither a key nor a signing secret can be read back. */
function RevealOnce({ value, title }: { value: string; title: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
        <AlertTriangle className="size-4" />
        {title}
      </p>
      <p className="text-xs text-muted-foreground">
        This is the only time it is shown. If you lose it, generate another.
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
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
              toast.error("Could not copy. Select it and copy manually.");
            }
          }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab({ appId, onClosed }: { appId: string; onClosed: () => void }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading } = useQuery({
    queryKey: ["connected-app", appId],
    queryFn: () => getConnectedApp(appId),
  });

  const app = data?.app;

  const [form, setForm] = React.useState({
    name: "",
    description: "",
    product_url: "",
    catalog_mode: "PUSH",
    catalog_pull_url: "",
    actions_url: "",
    allowed_origins: "",
    environment: "LIVE",
    status: "ACTIVE",
  });
  const [secret, setSecret] = React.useState<string | null>(null);

  // Seed the form once the app loads. Keyed on updated_at so a successful save
  // resyncs, but ordinary typing is never clobbered by a background refetch.
  React.useEffect(() => {
    if (!app) return;
    setForm({
      name: app.name,
      description: app.description ?? "",
      product_url: app.product_url ?? "",
      catalog_mode: app.catalog_mode,
      catalog_pull_url: app.catalog_pull_url ?? "",
      actions_url: app.actions_url ?? "",
      allowed_origins: app.allowed_origins.join("\n"),
      environment: app.environment,
      status: app.status,
    });
    // Seeding only. Depending on `app` itself would reseed on every background
    // refetch and wipe whatever the admin is halfway through typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.id, app?.updated_at]);

  const saveMutation = useMutation({
    mutationFn: () =>
      updateConnectedApp(appId, {
        name: form.name,
        description: form.description || null,
        product_url: form.product_url || null,
        catalog_mode: form.catalog_mode,
        catalog_pull_url: form.catalog_pull_url || null,
        actions_url: form.actions_url || null,
        allowed_origins: form.allowed_origins
          .split("\n")
          .map((o) => o.trim())
          .filter(Boolean),
        environment: form.environment,
        status: form.status,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connected-app", appId] });
      void queryClient.invalidateQueries({ queryKey: ["connected-apps"] });
      toast.success("Saved");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const secretMutation = useMutation({
    mutationFn: () => rotateActionsSecret(appId),
    onSuccess: (result) => setSecret(result.secret),
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteConnectedApp(appId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["connected-apps"] });
      toast.success("Product removed");
      onClosed();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !app) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="app-name">Name</Label>
        <Input
          id="app-name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-description">Description</Label>
        <Textarea
          id="app-description"
          rows={2}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="app-url">Product URL</Label>
        <Input
          id="app-url"
          value={form.product_url}
          onChange={(e) => setForm({ ...form, product_url: e.target.value })}
          placeholder="https://app.example.com"
        />
        <p className="text-xs text-muted-foreground">
          Used to deep-link from a lead record into your product.
        </p>
      </div>

      {/* ---- Status ---- */}
      <div className="flex items-center justify-between border-t pt-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Receiving data</p>
          <p className="text-xs text-muted-foreground">
            Pausing rejects new events and catalog syncs. Nothing already stored is lost.
          </p>
        </div>
        <Switch
          checked={form.status === "ACTIVE"}
          onCheckedChange={(on) => setForm({ ...form, status: on ? "ACTIVE" : "PAUSED" })}
        />
      </div>

      <div className="flex items-center justify-between border-t pt-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Test mode</p>
          <p className="text-xs text-muted-foreground">
            Events are stored and visible but never move a lead score or alert an agent.
          </p>
        </div>
        <Switch
          checked={form.environment === "TEST"}
          onCheckedChange={(on) => setForm({ ...form, environment: on ? "TEST" : "LIVE" })}
        />
      </div>

      {/* ---- Catalog ---- */}
      <div className="space-y-1.5">
        <Label htmlFor="connectedproductsheet-catalog">Catalog</Label>
        <Select
          value={form.catalog_mode}
          onValueChange={(value) => setForm({ ...form, catalog_mode: value })}
        >
          <SelectTrigger id="connectedproductsheet-catalog">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PUSH">Product pushes it to us</SelectItem>
            <SelectItem value="PULL">We fetch it from a URL, hourly</SelectItem>
            <SelectItem value="MANUAL">Managed by hand in the CRM</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.catalog_mode === "PULL" ? (
        <div className="space-y-1.5">
          <Label htmlFor="app-feed">Catalog feed URL</Label>
          <Input
            id="app-feed"
            value={form.catalog_pull_url}
            onChange={(e) => setForm({ ...form, catalog_pull_url: e.target.value })}
            placeholder="https://app.example.com/crm/catalog.json"
          />
          <p className="text-xs text-muted-foreground">Must be https.</p>
        </div>
      ) : null}

      {/* ---- Browser tracker ---- */}
      <div className="space-y-1.5">
        <Label htmlFor="app-origins">Allowed origins</Label>
        <Textarea
          id="app-origins"
          rows={3}
          value={form.allowed_origins}
          onChange={(e) => setForm({ ...form, allowed_origins: e.target.value })}
          placeholder={"https://app.example.com\nhttps://www.example.com"}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          One per line. Required before a browser key can be created, and the only thing
          standing between that key and the whole internet.
        </p>
      </div>

      {/* ---- Actions ---- */}
      <div className="space-y-1.5">
        <Label htmlFor="app-actions">Actions endpoint</Label>
        <Input
          id="app-actions"
          value={form.actions_url}
          onChange={(e) => setForm({ ...form, actions_url: e.target.value })}
          placeholder="https://app.example.com/crm/actions"
        />
        <p className="text-xs text-muted-foreground">
          Where the CRM calls your product when an agent fires an action. Must be https.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={secretMutation.isPending}
            onClick={() => secretMutation.mutate()}
          >
            <KeyRound className="size-3.5" />
            {app.actions_configured ? "Rotate signing secret" : "Generate signing secret"}
          </Button>
          {app.actions_configured ? (
            <Badge variant="outline" className="text-[10px]">
              Secret set
            </Badge>
          ) : null}
        </div>
      </div>

      {secret ? <RevealOnce value={secret} title="Your signing secret" /> : null}

      <div className="flex items-center gap-2 border-t pt-4">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? "Saving..." : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto text-muted-foreground hover:text-destructive"
          disabled={deleteMutation.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: "Remove this product?",
              description: `Everything ${app.name} sent is deleted: its catalog, offers, events and engagement history. Its API keys are revoked. This cannot be undone.`,
              destructive: true,
              confirmText: "Remove",
            });
            if (ok) deleteMutation.mutate();
          }}
        >
          <Trash2 className="size-4" />
          Remove
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function KeysTab({ appId }: { appId: string }) {
  const queryClient = useQueryClient();
  const [revealed, setRevealed] = React.useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["connected-app", appId],
    queryFn: () => getConnectedApp(appId),
  });

  const mutation = useMutation({
    mutationFn: (scope: "SECRET" | "PUBLISHABLE") => createAppKey(appId, { scope }),
    onSuccess: (key) => {
      setRevealed(key.key);
      void queryClient.invalidateQueries({ queryKey: ["connected-app", appId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading || !data) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("SECRET")}
        >
          New server key
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("PUBLISHABLE")}
        >
          New browser key
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A server key can do everything. A browser key ships in your page source, so it is
        locked to your allowed origins and can only send events.
      </p>

      {revealed ? <RevealOnce value={revealed} title="Your new key" /> : null}

      {data.keys.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No live keys.</p>
      ) : (
        <ul className="space-y-2">
          {data.keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-2 border-t pt-3">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {key.key_prefix}...
              </code>
              <Badge variant="outline" className="text-[10px]">
                {key.scope === "PUBLISHABLE" ? "Browser" : "Server"}
              </Badge>
              <span className="truncate text-sm text-muted-foreground">{key.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {key.last_used_at ? `used ${timeAgo(key.last_used_at)}` : "never used"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const CATEGORY_LABEL: Record<string, string> = {
  PAGE: "Browsing",
  ACTION: "Action",
  LIFECYCLE: "Lifecycle",
  COMMERCE: "Commerce",
  SUPPORT: "Support",
};

function EventRow({ appId, def }: { appId: string; def: EventDefinition }) {
  const queryClient = useQueryClient();
  const [weight, setWeight] = React.useState(String(def.intent_weight));

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => updateEventDefinition(appId, def.id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["event-definitions", appId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const pending = def.review_status === "NEEDS_REVIEW";

  return (
    <li className={`space-y-2 rounded-lg border p-3 ${pending ? "border-amber-500/40 bg-amber-500/5" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{def.name}</code>
        <span className="truncate text-sm">{def.label}</span>
        <Badge variant="outline" className="text-[10px]">
          {CATEGORY_LABEL[def.category] ?? def.category}
        </Badge>
        {def.is_high_intent ? (
          <Badge
            variant="outline"
            className="text-[10px] text-red-700 dark:text-red-300"
          >
            Alerts owner
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
          seen {def.event_count}x
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`w-${def.id}`} className="text-xs text-muted-foreground">
          Counts for
        </Label>
        <Input
          id={`w-${def.id}`}
          type="number"
          min={-100}
          max={100}
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          // Committed on blur: each save recomputes scores for everyone who has
          // ever sent this event.
          onBlur={() => {
            const next = Number(weight);
            if (Number.isFinite(next) && next !== def.intent_weight) {
              mutation.mutate({ intent_weight: Math.max(-100, Math.min(100, next)) });
            }
          }}
          className="h-8 w-20"
        />
        <span className="text-xs text-muted-foreground">of 100 toward buying intent</span>

        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={`a-${def.id}`} className="text-xs text-muted-foreground">
            Alert
          </Label>
          <Switch
            id={`a-${def.id}`}
            checked={def.is_high_intent}
            onCheckedChange={(on) => mutation.mutate({ is_high_intent: on })}
          />
        </div>
      </div>

      {pending ? (
        <div className="flex items-center gap-2 border-t pt-2">
          <p className="text-xs text-muted-foreground">
            New. Stored, but not counted until you activate it.
          </p>
          <Button
            type="button"
            size="sm"
            className="ml-auto"
            onClick={() => mutation.mutate({ review_status: "ACTIVE" })}
          >
            Activate
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => mutation.mutate({ review_status: "IGNORED" })}
          >
            Ignore
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function EventsTab({ appId }: { appId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["event-definitions", appId],
    queryFn: () => listEventDefinitions(appId),
  });

  if (isLoading) return <Skeleton className="h-48 w-full" />;

  const defs = data ?? [];
  // Unreviewed events first: they are the only ones that need a decision.
  const sorted = [...defs].sort((a, b) => {
    const rank = (d: EventDefinition) => (d.review_status === "NEEDS_REVIEW" ? 0 : 1);
    return rank(a) - rank(b) || b.event_count - a.event_count || a.name.localeCompare(b.name);
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Every event this product sends. A number here is how much that event pushes
        someone toward looking like a buyer, and it decides who shows up in Signals.
      </p>
      {sorted.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No events registered yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((def) => (
            <EventRow key={def.id} appId={appId} def={def} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Everything you can change about one connected product, in one place. */
export function ConnectedProductSheet({
  appId,
  onOpenChange,
}: {
  appId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data } = useQuery({
    queryKey: ["connected-app", appId],
    queryFn: () => getConnectedApp(appId as string),
    enabled: !!appId,
  });

  return (
    <Sheet open={!!appId} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto p-5 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{data?.app.name ?? "Connected product"}</SheetTitle>
          <SheetDescription>
            How this product talks to the CRM, and what its events mean.
          </SheetDescription>
        </SheetHeader>

        {appId ? (
          <Tabs defaultValue="settings" className="mt-5">
            <TabsList>
              <TabsTrigger value="settings">Settings</TabsTrigger>
              <TabsTrigger value="keys">Keys</TabsTrigger>
              <TabsTrigger value="events">Events</TabsTrigger>
              <TabsTrigger value="setup">Setup</TabsTrigger>
            </TabsList>
            <TabsContent value="settings" className="mt-4">
              <SettingsTab appId={appId} onClosed={() => onOpenChange(false)} />
            </TabsContent>
            <TabsContent value="keys" className="mt-4">
              <KeysTab appId={appId} />
            </TabsContent>
            <TabsContent value="events" className="mt-4">
              <EventsTab appId={appId} />
            </TabsContent>
            <TabsContent value="setup" className="mt-4">
              {data?.app ? <ProductSetupGuide app={data.app} /> : null}
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
