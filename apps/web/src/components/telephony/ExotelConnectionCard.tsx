import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Link2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { apiBaseUrl } from "@/lib/api/client";
import {
  removeTelephony,
  saveTelephony,
  validateTelephony,
  type TelephonyConfig,
  type TelephonyStatus,
} from "@/lib/api/telephony";

const statusBadge = (status: TelephonyStatus) => {
  if (status === "ACTIVE") return <Badge variant="success">Connected</Badge>;
  if (status === "DISABLED") return <Badge variant="neutral">Disabled</Badge>;
  return <Badge variant="warning">Not verified</Badge>;
};

const SUBDOMAINS = ["api.in.exotel.com", "api.exotel.com"] as const;

function WebhookUrlRow({ label, url, hint }: { label: string; url: string; hint: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium">{label}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-xs text-muted-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Could not copy. Select the text and copy manually.");
            }
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <code className="block overflow-x-auto whitespace-nowrap border-b py-1.5 font-mono text-[11px]">
        {url}
      </code>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

// BYO Exotel: credentials + the webhook URLs the admin pastes into their
// App Bazaar call flow, with the flow-building steps inline so the setup never
// needs a support ticket.
export function ExotelConnectionCard({ cfg }: { cfg: TelephonyConfig | undefined }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [sid, setSid] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [apiToken, setApiToken] = React.useState("");
  const [subdomain, setSubdomain] = React.useState<string>("api.in.exotel.com");
  const [exophone, setExophone] = React.useState("");

  const isExotel = cfg?.provider === "EXOTEL";
  const configured = !!cfg?.configured && isExotel;
  const secretsSet = configured && !!cfg?.auth_token_set;

  React.useEffect(() => {
    if (!cfg || !isExotel) return;
    setExophone((v) => v || cfg.from_number || "");
    setSubdomain((v) => (v !== "api.in.exotel.com" ? v : (cfg.subdomain ?? v)));
  }, [cfg, isExotel]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["telephony"] });
    queryClient.invalidateQueries({ queryKey: ["telephony-numbers"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTelephony({
        provider: "EXOTEL",
        accountSid: sid,
        apiKey,
        authToken: apiToken,
        fromNumber: exophone,
        subdomain,
      }),
    onSuccess: () => {
      toast.success("Exotel credentials saved. Validate to connect.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save credentials."),
  });

  const validateMutation = useMutation({
    mutationFn: validateTelephony,
    onSuccess: (c) => {
      if (c.status === "ACTIVE") toast.success("Exotel account connected.");
      else toast.error(c.last_error || "Validation failed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not validate."),
  });

  const removeMutation = useMutation({
    mutationFn: removeTelephony,
    onSuccess: () => {
      toast.success("Exotel disconnected.");
      setSid("");
      setApiKey("");
      setApiToken("");
      setExophone("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Exotel?",
      description:
        "Inbound routing stops (the webhook URLs go dead) and click-to-call reverts to the default. Reconnecting mints NEW webhook URLs you must paste into your Exotel flow again.",
      confirmText: "Disconnect",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  };

  // Secrets are write-only: the API never returns them, so the secret fields
  // start blank and a blank value on save keeps the stored one.
  const savedSid = configured ? (cfg?.account_sid ?? null) : null;
  const keyHint = configured ? (cfg?.api_key_hint ?? null) : null;
  const tokenHint = configured ? (cfg?.auth_token_hint ?? null) : null;
  const keepNote = (hint: string | null) => (
    <span className="text-xs font-normal text-muted-foreground">
      (saved{hint ? `: ${hint}` : ""}; leave blank to keep)
    </span>
  );

  const canSubmit = configured
    ? !!(sid || apiKey || apiToken || exophone)
    : !!(sid && apiKey && apiToken && exophone);

  // The public webhook base: strip the /api/v1 suffix variance by building from
  // the configured API base URL directly.
  const webhookBase = `${apiBaseUrl.replace(/\/$/, "")}/telephony/webhooks/exotel`;
  const token = configured ? cfg?.webhook_token : null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-brand" />
            Your Exotel account
          </CardTitle>
          <CardDescription>
            Leads call your ExoPhone; the CRM decides which agent's phone rings. Outbound
            calls ring the agent first, then the lead, showing an ExoPhone as caller ID.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured && cfg ? statusBadge(cfg.status) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cfg?.exotelSimulated ? (
          <Badge variant="warning">Simulated mode: no real calls are placed</Badge>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) saveMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="exo-sid">
                Exotel SID{" "}
                {configured ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    (leave blank to keep)
                  </span>
                ) : null}
              </Label>
              <Input
                id="exo-sid"
                value={sid}
                placeholder={savedSid ?? "yourcompany1"}
                autoComplete="off"
                onChange={(e) => setSid(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exo-subdomain">Region</Label>
              <Select value={subdomain} onValueChange={setSubdomain}>
                <SelectTrigger id="exo-subdomain">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUBDOMAINS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "api.in.exotel.com" ? "India (api.in.exotel.com)" : "Singapore (api.exotel.com)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exo-key">
                API key{" "}
                {configured && cfg?.api_key_set ? keepNote(keyHint) : null}
              </Label>
              <Input
                id="exo-key"
                type="password"
                value={apiKey}
                placeholder={configured && cfg?.api_key_set ? "Enter a new key to replace it" : "From Exotel Settings, API"}
                autoComplete="new-password"
                onChange={(e) => setApiKey(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exo-token">
                API token{" "}
                {secretsSet ? keepNote(tokenHint) : null}
              </Label>
              <Input
                id="exo-token"
                type="password"
                value={apiToken}
                placeholder={secretsSet ? "Enter a new token to replace it" : "From Exotel Settings, API"}
                autoComplete="new-password"
                onChange={(e) => setApiToken(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exo-phone">Main ExoPhone</Label>
            <Input
              id="exo-phone"
              type="tel"
              value={exophone}
              placeholder="+15555550101"
              onChange={(e) => setExophone(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              The virtual number you publish. Inbound calls to it are routed by the CRM;
              outbound calls show it as caller ID unless the agent has a dedicated number.
            </p>
          </div>
          <Button type="submit" loading={saveMutation.isPending} disabled={!canSubmit}>
            Save credentials
          </Button>
        </form>

        {configured && cfg ? (
          <>
            <Separator />
            <div className="space-y-3">
              {cfg.status === "ACTIVE" ? (
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <ShieldCheck className="size-4" /> Connected and verified.
                </p>
              ) : cfg.last_error ? (
                <p className="text-sm text-danger">{cfg.last_error}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Validate to connect this account.</p>
              )}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  loading={validateMutation.isPending}
                  onClick={() => validateMutation.mutate()}
                >
                  <RefreshCw className="size-4" /> Validate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  loading={removeMutation.isPending}
                  onClick={handleDisconnect}
                >
                  <Trash2 className="size-4" /> Disconnect
                </Button>
              </div>
            </div>

            {token ? (
              <>
                <Separator />
                <div className="space-y-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <Link2 className="size-4 text-brand" />
                    Webhook URLs for your Exotel call flow
                  </p>
                  <WebhookUrlRow
                    label="Route URL (Connect applet)"
                    url={`${webhookBase}/${token}/route`}
                    hint='In App Bazaar, add a Connect applet, choose "Try number fetched from URL" and paste this. Turn ON "If call not answered, try next number".'
                  />
                  <WebhookUrlRow
                    label="Status URL (Passthru applet)"
                    url={`${webhookBase}/${token}/status`}
                    hint='Add a Passthru applet as the LAST step of the flow, paste this, and tick "Make Passthru Async".'
                  />
                  <WebhookUrlRow
                    label="Callback URL (outbound calls)"
                    url={`${webhookBase}/${token}/callback`}
                    hint="Used automatically for click-to-call status updates. Nothing to configure in Exotel."
                  />
                  <div className="border-t pt-3 text-xs text-muted-foreground">
                    <p className="mb-1 font-medium text-foreground">Flow checklist</p>
                    <ol className="list-inside list-decimal space-y-0.5">
                      <li>Exotel dashboard: App Bazaar, Create App.</li>
                      <li>Add a Connect applet with the Route URL above; ring time ~25s; enable dual-channel recording.</li>
                      <li>On the Connect applet's failure branch, add your voicemail or announcement (this also plays outside working hours).</li>
                      <li>Add the Passthru applet (async) with the Status URL as the last step.</li>
                      <li>Assign the app to your ExoPhone. Repeat for every agent-dedicated ExoPhone.</li>
                    </ol>
                  </div>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
