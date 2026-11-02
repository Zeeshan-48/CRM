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
  getRazorpayConfig,
  removeRazorpayConfig,
  saveRazorpayConfig,
  validateRazorpayConfig,
  type RazorpayStatus,
} from "@/lib/api/finance";
import { formatDateTime } from "@/lib/format";

const statusBadge = (status: RazorpayStatus) => {
  if (status === "ACTIVE") return <Badge variant="success">Connected</Badge>;
  if (status === "DISABLED") return <Badge variant="neutral">Disabled</Badge>;
  return <Badge variant="warning">Not validated</Badge>;
};

export function RazorpayConnectionCard() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const configQuery = useQuery({ queryKey: ["razorpay-config"], queryFn: getRazorpayConfig });
  const cfg = configQuery.data;

  const [keyId, setKeyId] = React.useState("");
  const [keySecret, setKeySecret] = React.useState("");
  // Secrets are write-only: the API never returns them. The fields start
  // blank, and a blank value on save keeps the stored credential.

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["razorpay-config"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => saveRazorpayConfig({ keyId: keyId.trim(), keySecret: keySecret.trim() }),
    onSuccess: () => {
      toast.success("Razorpay credentials saved. Click Validate to verify them.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save credentials."),
  });

  const validateMutation = useMutation({
    mutationFn: validateRazorpayConfig,
    onSuccess: (data) => {
      if (data.status === "ACTIVE") toast.success("Razorpay connected and verified.");
      else toast.message(data.last_error || "Validation failed. Check the keys.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not validate."),
  });

  const removeMutation = useMutation({
    mutationFn: removeRazorpayConfig,
    onSuccess: () => {
      toast.success("Razorpay disconnected.");
      setKeyId("");
      setKeySecret("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  // On update both fields are optional (blank keeps the stored value); a first
  // save needs both.
  const secretSet = !!cfg?.key_secret_set;
  const canSave = cfg?.configured
    ? !!(keyId.trim() || keySecret.trim())
    : !!(keyId.trim() && keySecret.trim());
  const secretHint = cfg?.key_secret_hint ?? null;


  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <GatewayLogo name="Razorpay" size={24} />
            Razorpay connection
          </CardTitle>
          <div className="flex shrink-0 items-center gap-2">
            {cfg ? statusBadge(cfg.status) : <Spinner size="sm" />}
          </div>
        </div>
        <CardDescription>
          Connect your Razorpay account to collect real payments. Test-mode keys
          let you trial it without charging anyone.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {configQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner size="md" className="text-brand" label="Loading Razorpay settings" />
          </div>
        ) : (
          <>
            {cfg?.status === "ACTIVE" ? (
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <div>
                  <p className="text-sm font-medium text-success">
                    Connected{cfg.key_id ? ` · ${cfg.key_id}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Payment links now collect to your Razorpay account.
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
                  ? "Running in simulation mode: payment links are generated but not real. Connect to collect for real."
                  : "Until you connect Razorpay, online collection is unavailable (you can still mark invoices paid manually)."}
              </p>
            )}

            <GatewayInstructions
              defaultOpen={cfg?.status !== "ACTIVE"}
              accentClass="bg-brand/10 text-brand"
              docHref="https://dashboard.razorpay.com/app/keys"
              docLabel="Open Razorpay API keys"
              steps={[
                <>
                  Sign in to your <strong>Razorpay Dashboard</strong> and switch
                  to <strong>Test Mode</strong> to trial without charging anyone.
                </>,
                <>
                  Open <NavPath crumbs={["Settings", "API Keys"]} />.
                </>,
                <>
                  Click <strong>Generate Key</strong>, then copy the{" "}
                  <strong>Key ID</strong> and <strong>Key Secret</strong>.
                </>,
                <>
                  Paste both below, hit <strong>Save credentials</strong>, then{" "}
                  <strong>Validate</strong>.
                </>,
              ]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="rzp-key-id">
                  Key ID{cfg?.key_id ? " (leave blank to keep)" : ""}
                </Label>
                <Input
                  id="rzp-key-id"
                  // The API returns only a masked key id, shown as the placeholder.
                  placeholder={cfg?.key_id ?? "rzp_test_xxxxxxxx"}
                  autoComplete="off"
                  value={keyId}
                  onChange={(e) => setKeyId(e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rzp-key-secret">
                  Key secret
                  {secretSet ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}(saved{secretHint ? `: ${secretHint}` : ""}; leave blank to keep)
                    </span>
                  ) : null}
                </Label>
                <Input
                  id="rzp-key-secret"
                  type="password"
                  placeholder={secretSet ? "Enter a new secret to replace it" : "Key secret"}
                  autoComplete="new-password"
                  value={keySecret}
                  onChange={(e) => setKeySecret(e.target.value)}
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button loading={saveMutation.isPending} disabled={!canSave} onClick={() => saveMutation.mutate()}>
                  Save credentials
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
                      title: "Disconnect Razorpay?",
                      description: "Online collection will stop.",
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
              Your key secret is encrypted at rest.
              {cfg?.verified_at ? ` Last verified ${formatDateTime(cfg.verified_at)}.` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
