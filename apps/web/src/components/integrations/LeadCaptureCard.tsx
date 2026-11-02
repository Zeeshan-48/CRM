import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus, RotateCcw, Trash2, Webhook } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Spinner } from "@/components/ui/spinner";
import {
  apiOrigin,
  createApiKey,
  getIngestSettings,
  listApiKeys,
  listIngestEvents,
  revokeApiKey,
  rotateIngestToken,
  type CreatedApiKey,
  type IngestEventStatus,
} from "@/lib/api/integrations";
import { formatDate } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";

// Small copy-to-clipboard button with a transient "copied" tick.
function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not copy to clipboard");
        }
      }}
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      {label ?? (copied ? "Copied" : "Copy")}
    </Button>
  );
}

const STATUS_BADGE: Record<IngestEventStatus, { variant: "success" | "brand" | "warning" | "destructive"; label: string }> = {
  CREATED: { variant: "success", label: "Created" },
  DEDUPED: { variant: "brand", label: "Updated" },
  SPAM: { variant: "warning", label: "Spam" },
  REJECTED: { variant: "destructive", label: "Rejected" },
};

export function LeadCaptureCard() {
  const isAdmin = useAuthStore((s) => s.user?.role) === "ADMIN";
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({ queryKey: ["ingest-settings"], queryFn: getIngestSettings });
  const keysQuery = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys });
  const eventsQuery = useQuery({ queryKey: ["ingest-events"], queryFn: listIngestEvents });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [keyName, setKeyName] = React.useState("");
  const [newKey, setNewKey] = React.useState<CreatedApiKey | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createApiKey(keyName.trim() || "Default key"),
    onSuccess: (created) => {
      setNewKey(created);
      setKeyName("");
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not create the key"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeApiKey(id),
    onSuccess: () => {
      toast.success("API key revoked");
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not revoke the key"),
  });

  const rotateMutation = useMutation({
    mutationFn: rotateIngestToken,
    onSuccess: () => {
      toast.success("Token rotated. Update your form URLs.");
      queryClient.invalidateQueries({ queryKey: ["ingest-settings"] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not rotate the token"),
  });

  const settings = settingsQuery.data;
  const endpointUrl = settings ? `${apiOrigin}${settings.apiKeyPath}` : "";
  const tokenUrl = settings ? `${apiOrigin}${settings.tokenPath}` : "";
  const curl = endpointUrl
    ? `curl -X POST ${endpointUrl} \\\n  -H "Authorization: Bearer <YOUR_API_KEY>" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Jane Doe","email":"jane@acme.example.com","phone":"+15551234567","source":"Website"}'`
    : "";

  return (
    <section className="reveal space-y-4" style={{ animationDelay: "80ms" }}>
      {/* Endpoint + how-to */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center text-brand">
              <Webhook className="size-4" />
            </span>
            Lead capture (inbound)
          </CardTitle>
          <CardDescription>
            Let other platforms send leads straight into this workspace. POST a lead to your
            endpoint and it lands scored, assigned, and enrolled, exactly like a lead added here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Your endpoint (API key auth)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                {endpointUrl || "Loading..."}
              </code>
              {endpointUrl ? <CopyButton value={endpointUrl} /> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Send the header <code>Authorization: Bearer &lt;API key&gt;</code>. Works with Zapier,
              Make, and any custom form or backend.
            </p>
          </div>

          {curl ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label>Sample request</Label>
                <CopyButton value={curl} label="Copy curl" />
              </div>
              <pre className="overflow-x-auto rounded-md border bg-muted p-3 text-xs leading-relaxed">
                {curl}
              </pre>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>No-code form URL (token in the link)</Label>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                {tokenUrl || "Loading..."}
              </code>
              {tokenUrl ? <CopyButton value={tokenUrl} /> : null}
              {isAdmin ? (
                <Button
                  variant="outline"
                  size="sm"
                  loading={rotateMutation.isPending}
                  onClick={() => rotateMutation.mutate()}
                >
                  <RotateCcw className="size-4" />
                  Rotate
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              For form tools that can't send headers. Anyone with this URL can submit leads, so keep
              it private and rotate if leaked.
            </p>
          </div>

          <div className="border-t pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Accepted fields:</span> name (or
            first_name + last_name), email, phone, company, city, country, source, campaign,
            utm_campaign, tags[]. Anything else is saved into the lead's notes.
          </div>
        </CardContent>
      </Card>

      {/* API keys */}
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4 text-brand" />
              API keys
            </CardTitle>
            <CardDescription>
              Keys authenticate programmatic senders. The secret is shown once at creation.
            </CardDescription>
          </div>
          {isAdmin ? (
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" />
              New key
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {keysQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (keysQuery.data?.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No API keys yet.{isAdmin ? " Create one to start receiving leads." : ""}
            </p>
          ) : (
            <ul className="divide-y">
              {keysQuery.data?.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{k.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      <code>{k.key_prefix}…</code> ·{" "}
                      {k.last_used_at
                        ? `last used ${formatDate(k.last_used_at)}`
                        : "never used"}
                    </p>
                  </div>
                  {isAdmin ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Revoke key"
                      loading={revokeMutation.isPending && revokeMutation.variables === k.id}
                      onClick={() => revokeMutation.mutate(k.id)}
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Recent deliveries */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent deliveries
          </CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQuery.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (eventsQuery.data?.length ?? 0) === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No inbound leads yet. They'll show here as they arrive.
            </p>
          ) : (
            <ul className="divide-y">
              {eventsQuery.data?.slice(0, 20).map((e) => {
                const badge = STATUS_BADGE[e.status];
                return (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{e.source}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatDate(e.created_at)}
                        {e.error ? ` · ${e.error}` : ""}
                      </p>
                    </div>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Create key dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>
              Name it so you remember where it's used. The secret is shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="key-name">Name</Label>
            <Input
              id="key-name"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. Website form, Zapier"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Show-once secret dialog */}
      <Dialog open={!!newKey} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>
              This is the only time the full key is shown. Store it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
              {newKey?.key}
            </code>
            {newKey ? <CopyButton value={newKey.key} /> : null}
          </div>
          <DialogFooter>
            <Button onClick={() => setNewKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
