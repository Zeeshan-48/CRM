import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import {
  GatewayInstructions,
  NavPath,
} from "@/components/finance/GatewayInstructions";
import { GatewayLogo } from "@/components/finance/GatewayLogo";
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
import { Spinner } from "@/components/ui/spinner";
import {
  getStripeConfig,
  removeStripeConfig,
  saveStripeConfig,
  validateStripeConfig,
  type RazorpayStatus,
} from "@/lib/api/finance";
import { formatDateTime } from "@/lib/format";

const statusBadge = (status: RazorpayStatus) => {
  if (status === "ACTIVE") return <Badge variant="success">Connected</Badge>;
  if (status === "DISABLED") return <Badge variant="neutral">Disabled</Badge>;
  return <Badge variant="warning">Not validated</Badge>;
};

export function StripeConnectionCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const configQuery = useQuery({ queryKey: ["stripe-config"], queryFn: getStripeConfig });
  const cfg = configQuery.data;

  const [secretKey, setSecretKey] = React.useState("");
  // Secrets are write-only: the API never returns them. The fields start
  // blank, and a blank value on save keeps the stored credential.

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["stripe-config"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => saveStripeConfig(secretKey.trim()),
    onSuccess: () => {
      toast.success("Stripe key saved. Click Validate to verify it.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save the key."),
  });

  const validateMutation = useMutation({
    mutationFn: validateStripeConfig,
    onSuccess: (data) => {
      if (data.status === "ACTIVE") toast.success("Stripe connected and verified.");
      else toast.message(data.last_error || "Validation failed. Check the key.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not validate."),
  });

  const removeMutation = useMutation({
    mutationFn: removeStripeConfig,
    onSuccess: () => {
      toast.success("Stripe disconnected.");
      setSecretKey("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  const secretSet = !!cfg?.secret_key_set;
  // Blank on update keeps the stored key.
  const canSave = !!(secretKey.trim() || secretSet);


  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <GatewayLogo name="Stripe" size={24} />
            Stripe connection
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            {cfg ? statusBadge(cfg.status) : <Spinner size="sm" />}
          </div>
        </div>
        <CardDescription>
          Connect your Stripe account to collect payments. A test secret key lets
          you trial it without charging anyone.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {configQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" className="text-brand" label="Loading Stripe settings" />
          </div>
        ) : (
          <>
            {cfg?.status === "ACTIVE" ? (
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-medium text-success">
                    Connected{cfg.secret_key_hint ? ` · ${cfg.secret_key_hint}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Checkout links collect to your Stripe account.
                  </p>
                </div>
              </div>
            ) : cfg?.last_error ? (
              <p className="text-sm text-danger">
                {cfg.last_error}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {cfg?.simulated
                  ? "Running in simulation mode: checkout links are generated but not real."
                  : "Add your Stripe secret key to collect via Stripe."}
              </p>
            )}

            <GatewayInstructions
              defaultOpen={cfg?.status !== "ACTIVE"}
              accentClass="bg-brand/10 text-brand"
              docHref="https://dashboard.stripe.com/apikeys"
              docLabel="Open Stripe API keys"
              steps={[
                <>
                  Sign in to your <strong>Stripe Dashboard</strong>. A{" "}
                  <strong>test</strong> key lets you trial without charging
                  anyone.
                </>,
                <>
                  Open <NavPath crumbs={["Developers", "API keys"]} />.
                </>,
                <>
                  Copy your <strong>Secret key</strong> (it starts with{" "}
                  <code>sk_test_</code> in test mode).
                </>,
                <>
                  Paste it below, hit <strong>Save key</strong>, then{" "}
                  <strong>Validate</strong>.
                </>,
              ]}
            />

            <div className="space-y-1.5">
              <Label htmlFor="stripe-secret">
                Secret key
                {secretSet ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}(saved{cfg?.secret_key_hint ? `: ${cfg.secret_key_hint}` : ""}; leave blank to keep)
                  </span>
                ) : null}
              </Label>
              <Input
                id="stripe-secret"
                type="password"
                placeholder={secretSet ? "Enter a new key to replace it" : "sk_test_xxxxxxxx"}
                autoComplete="new-password"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                autoCapitalize="none"
                spellCheck={false}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button loading={saveMutation.isPending} disabled={!canSave} onClick={() => saveMutation.mutate()}>
                  Save key
                </Button>
                <Button
                  variant="outline"
                  loading={validateMutation.isPending}
                  disabled={!cfg?.configured}
                  onClick={() => validateMutation.mutate()}
                >
                  {validateMutation.isPending ? null : <RefreshCw className="size-4" />} Validate
                </Button>
              </div>
              {cfg?.configured ? (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={removeMutation.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Disconnect Stripe?",
                      description: "Online collection via Stripe will stop.",
                      confirmText: "Disconnect",
                      destructive: true,
                    });
                    if (ok) removeMutation.mutate();
                  }}
                >
                  {removeMutation.isPending ? null : <Trash2 className="size-4 text-danger" />}{" "}
                  Disconnect
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-muted-foreground">
              Your secret key is encrypted at rest.
              {cfg?.verified_at ? ` Last verified ${formatDateTime(cfg.verified_at)}.` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
