import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Link2, RefreshCw, Trash2 } from "lucide-react";
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
          {copied ? (
            <>
              <Check className="size-3 text-success" />
              Copied
            </>
          ) : (
            <>
              <Copy className="size-3" />
              Copy
            </>
          )}
        </Button>
      </div>
      <div className="rounded-md border bg-muted/40 px-2 py-1.5 font-mono text-xs break-all select-all">
        {url}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function PlivoConnectionCard({ cfg }: { cfg?: TelephonyConfig }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [authId, setAuthId] = React.useState("");
  const [authToken, setAuthToken] = React.useState("");
  const [fromNumber, setFromNumber] = React.useState("");

  const isPlivo = cfg?.provider === "PLIVO";
  const configured = !!cfg?.configured && isPlivo;

  React.useEffect(() => {
    if (!cfg || !isPlivo) return;
    setFromNumber((v) => v || cfg.from_number || "");
  }, [cfg, isPlivo]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["telephony"] });
    queryClient.invalidateQueries({ queryKey: ["telephony-numbers"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      saveTelephony({
        provider: "PLIVO",
        accountSid: authId,
        authToken: authToken,
        fromNumber: fromNumber,
      }),
    onSuccess: () => {
      toast.success("Plivo credentials saved. Click Validate to test connection.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save Plivo credentials."),
  });

  const validateMutation = useMutation({
    mutationFn: validateTelephony,
    onSuccess: (c) => {
      if (c.status === "ACTIVE") toast.success("Plivo account verified & connected!");
      else toast.error(c.last_error || "Validation failed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not validate Plivo connection."),
  });

  const removeMutation = useMutation({
    mutationFn: removeTelephony,
    onSuccess: () => {
      toast.success("Plivo disconnected.");
      setAuthId("");
      setAuthToken("");
      setFromNumber("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Plivo?",
      description: "Outbound calling and call recordings via Plivo will be disabled.",
      confirmText: "Disconnect",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  };

  const savedAuthId = configured ? (cfg?.account_sid ?? null) : null;
  const tokenHint = configured ? (cfg?.auth_token_hint ?? null) : null;
  const keepNote = (hint: string | null) => (
    <span className="text-xs font-normal text-muted-foreground">
      (saved{hint ? `: ${hint}` : ""}; leave blank to keep)
    </span>
  );

  const canSubmit = configured
    ? !!(authId || authToken || fromNumber)
    : !!(authId && authToken && fromNumber);

  const webhookBase = `${apiBaseUrl.replace(/\/$/, "")}/telephony/webhooks/plivo`;
  const token = configured ? cfg?.webhook_token : null;

  return (
    <Card className="border-brand/40 shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-brand">
            <KeyRound className="size-4 text-brand" />
            Plivo Cloud Telephony (Cost-Effective Calling)
          </CardTitle>
          <CardDescription>
            Low-cost voice calling and call recording. 30–50% cheaper than Twilio.
            Dual-channel bridging connects your agent first, then dials the customer displaying your Plivo caller ID.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured && cfg ? statusBadge(cfg.status) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cfg?.plivoSimulated ? (
          <Badge variant="warning">Simulated mode: Calls run without deducting Plivo credits</Badge>
        ) : null}

        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="plivo-auth-id" className="flex items-center gap-2">
              Plivo Auth ID
              {savedAuthId && !authId ? (
                <span className="text-xs font-normal text-muted-foreground">
                  (saved: {savedAuthId}; leave blank to keep)
                </span>
              ) : null}
            </Label>
            <Input
              id="plivo-auth-id"
              value={authId}
              onChange={(e) => setAuthId(e.target.value)}
              placeholder="e.g. MAMZXXXXXXXXXXXXXXXX"
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-[11px] text-muted-foreground">
              Found on your Plivo Dashboard overview.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plivo-auth-token" className="flex items-center gap-2">
              Plivo Auth Token
              {cfg?.auth_token_set && !authToken ? keepNote(tokenHint) : null}
            </Label>
            <Input
              id="plivo-auth-token"
              type="password"
              value={authToken}
              onChange={(e) => setAuthToken(e.target.value)}
              placeholder={cfg?.auth_token_set ? "••••••••••••••••" : "Paste your Plivo Auth Token"}
              autoComplete="new-password"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plivo-number">
              Plivo Virtual Number (Caller ID)
            </Label>
            <Input
              id="plivo-number"
              value={fromNumber}
              onChange={(e) => setFromNumber(e.target.value)}
              placeholder="+919876543210 or +14155550123"
            />
            <p className="text-[11px] text-muted-foreground">
              Must be an active rented number on your Plivo account in E.164 format.
            </p>
          </div>

          {cfg?.last_error ? (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 p-2 text-xs text-destructive">
              Last validation error: {cfg.last_error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button type="submit" size="sm" disabled={!canSubmit || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : configured ? "Update Credentials" : "Save Credentials"}
            </Button>

            {configured ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
                className="gap-1.5"
              >
                <RefreshCw
                  className={`size-3.5 ${validateMutation.isPending ? "animate-spin" : ""}`}
                />
                Validate Connection
              </Button>
            ) : null}

            {configured ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={removeMutation.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="mr-1.5 size-3.5" />
                Disconnect
              </Button>
            ) : null}
          </div>
        </form>

        {configured && token ? (
          <>
            <Separator className="my-3" />
            <div className="space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Link2 className="size-3.5 text-brand" />
                Plivo Application Webhook Endpoints
              </div>
              <p className="text-xs text-muted-foreground">
                If configuring a Plivo XML Application in your Plivo Console, set these webhook URLs:
              </p>

              <WebhookUrlRow
                label="Answer URL (Primary Call Flow)"
                url={`${webhookBase}/${token}/answer`}
                hint="Plivo requests this endpoint when the agent answers to bridge the call to the client."
              />

              <WebhookUrlRow
                label="Hangup URL (Call Duration & Status)"
                url={`${webhookBase}/${token}/hangup`}
                hint="Plivo posts here when the call finishes so duration and status update in the CRM."
              />

              <WebhookUrlRow
                label="Recording Callback URL (Audio Sync)"
                url={`${webhookBase}/${token}/recording`}
                hint="Plivo posts the dual-channel MP3 recording URL here once processed."
              />
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
