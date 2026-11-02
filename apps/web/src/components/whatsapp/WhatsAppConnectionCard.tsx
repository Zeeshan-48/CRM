import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { WhatsAppGlyph } from "@/components/whatsapp/WhatsAppGlyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import {
  exchangeEmbeddedSignup,
  getWhatsAppConfig,
  removeWhatsAppConfig,
  validateWhatsAppConfig,
  type WhatsAppStatus,
} from "@/lib/api/whatsapp";
import { formatDateTime } from "@/lib/format";
import {
  isEmbeddedSignupConfigured,
  launchEmbeddedSignup,
  loadFacebookSdk,
} from "@/lib/whatsapp/fb-sdk";

const statusBadge = (status: WhatsAppStatus) => {
  if (status === "ACTIVE") return <Badge variant="success">Connected</Badge>;
  if (status === "DISABLED") return <Badge variant="neutral">Disabled</Badge>;
  return <Badge variant="warning">Not connected</Badge>;
};

export function WhatsAppConnectionCard() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: getWhatsAppConfig,
  });
  const cfg = configQuery.data;

  const embeddedReady = isEmbeddedSignupConfigured();

  // Preload the Facebook SDK so the popup opens inside the click gesture.
  React.useEffect(() => {
    if (embeddedReady) void loadFacebookSdk().catch(() => undefined);
  }, [embeddedReady]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["whatsapp-config"] });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const result = await launchEmbeddedSignup();
      return exchangeEmbeddedSignup(result);
    },
    onSuccess: (data) => {
      if (data.status === "ACTIVE") toast.success("WhatsApp connected.");
      else toast.message(data.last_error || "Connected, finishing setup.");
      invalidate();
    },
    onError: (e: Error) => {
      // A user closing the popup is not an error worth shouting about.
      if (/cancel/i.test(e.message)) return;
      toast.error(e.message || "Could not connect WhatsApp.");
    },
  });

  const refreshMutation = useMutation({
    mutationFn: validateWhatsAppConfig,
    onSuccess: (data) => {
      if (data.status === "ACTIVE") toast.success("Refreshed from Meta.");
      else
        toast.message(
          data.last_error || "Could not refresh, try reconnecting.",
        );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not refresh."),
  });

  const removeMutation = useMutation({
    mutationFn: removeWhatsAppConfig,
    onSuccess: () => {
      toast.success("WhatsApp disconnected.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  const connected = cfg?.status === "ACTIVE";

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center text-success">
              <WhatsAppGlyph className="size-4" />
            </span>
            WhatsApp connection
          </CardTitle>
          {cfg ? statusBadge(cfg.status) : <Spinner size="sm" />}
        </div>
        <CardDescription>
          Connect your own WhatsApp Business number with Facebook. You&apos;ll
          sign in to Meta, pick the WhatsApp Business account and number to
          connect, and authorise this app, no tokens to copy. Takes under 5
          minutes.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {configQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner
              size="md"
              className="text-brand"
              label="Loading WhatsApp settings"
            />
          </div>
        ) : connected ? (
          <>
            <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-700">
                <ShieldCheck className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Connected
                  {cfg?.display_phone_number
                    ? ` · ${cfg.display_phone_number}`
                    : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {cfg?.verified_name ? `${cfg.verified_name} · ` : ""}Messages
                  now send from your own WhatsApp number.
                </p>
              </div>
            </div>

            <dl className="grid gap-3 sm:grid-cols-2">
              {cfg?.waba_id ? (
                <div className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    WABA ID
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-sm text-foreground">
                    {cfg.waba_id}
                  </dd>
                </div>
              ) : null}
              {cfg?.phone_number_id ? (
                <div className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2">
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Phone number ID
                  </dt>
                  <dd className="mt-0.5 truncate font-mono text-sm text-foreground">
                    {cfg.phone_number_id}
                  </dd>
                </div>
              ) : null}
            </dl>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <Button
                variant="outline"
                loading={refreshMutation.isPending}
                onClick={() => refreshMutation.mutate()}
              >
                {refreshMutation.isPending ? null : (
                  <RefreshCw className="size-4" />
                )}{" "}
                Refresh from Meta
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={removeMutation.isPending}
                onClick={() => {
                  if (
                    window.confirm(
                      "Disconnect WhatsApp? This stops outbound messaging.",
                    )
                  )
                    removeMutation.mutate();
                }}
              >
                {removeMutation.isPending ? null : (
                  <Trash2 className="size-4 text-red-600" />
                )}{" "}
                Disconnect
              </Button>
            </div>

            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <KeyRound className="size-3.5" />
              Your access token is stored encrypted and never shown in plain
              text.
              {cfg?.verified_at
                ? ` Last synced ${formatDateTime(cfg.verified_at)}.`
                : ""}
            </p>
          </>
        ) : (
          <>
            {cfg?.last_error ? (
              <p className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
                {cfg.last_error}
              </p>
            ) : cfg?.defaultAvailable ? (
              <p className="text-sm text-muted-foreground">
                {cfg.simulated
                  ? "Running in simulation mode, sends are recorded but not delivered. Connect a number to send for real."
                  : "Until you connect your own number, sends use the platform default WhatsApp tier."}
              </p>
            ) : null}

            <Button
              className="gap-2 bg-brand text-brand-foreground hover:bg-brand/90"
              loading={connectMutation.isPending}
              disabled={!embeddedReady}
              onClick={() => connectMutation.mutate()}
            >
              {connectMutation.isPending ? null : (
                <MessageCircle className="size-4" />
              )}
              Connect WhatsApp
            </Button>

            {!embeddedReady ? (
              <p className="text-xs text-muted-foreground">
                WhatsApp sign-in isn&apos;t configured yet. Set{" "}
                <code>VITE_META_APP_ID</code> and{" "}
                <code>VITE_META_WA_ES_CONFIG_ID</code> to enable the Connect
                button.
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" />
                We never see your Facebook password. Your access token is
                exchanged server-side and stored encrypted.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
