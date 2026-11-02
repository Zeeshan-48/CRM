import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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

// The BYO Twilio credentials card, extracted verbatim from the old telephony
// page when the provider selector arrived. Same query keys, same behavior.
export function TwilioConnectionCard({ cfg }: { cfg: TelephonyConfig | undefined }) {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const [accountSid, setAccountSid] = React.useState("");
  const [authToken, setAuthToken] = React.useState("");
  const [fromNumber, setFromNumber] = React.useState("");

  const isTwilio = cfg?.provider !== "EXOTEL";

  // Prefill the non-secret from-number once config loads, without clobbering
  // anything the admin is already typing. Only when this row IS a Twilio row.
  // Secrets are write-only: the API never returns them, so the token field
  // starts blank and a blank value on save keeps the stored token.
  React.useEffect(() => {
    if (!cfg || !isTwilio) return;
    setFromNumber((v) => v || cfg.from_number || "");
  }, [cfg, isTwilio]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["telephony"] });
  };

  const saveMutation = useMutation({
    mutationFn: () => saveTelephony({ provider: "TWILIO", accountSid, authToken, fromNumber }),
    onSuccess: () => {
      toast.success("Credentials saved. Validate to connect.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not save credentials."),
  });

  const validateMutation = useMutation({
    mutationFn: validateTelephony,
    onSuccess: (c) => {
      if (c.status === "ACTIVE") toast.success("Twilio account connected.");
      else toast.error(c.last_error || "Validation failed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not validate."),
  });

  const removeMutation = useMutation({
    mutationFn: removeTelephony,
    onSuccess: () => {
      toast.success("Disconnected. Calls now use the platform default number.");
      setAccountSid("");
      setAuthToken("");
      setFromNumber("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not disconnect."),
  });

  const handleDisconnect = async () => {
    const ok = await confirm({
      title: "Disconnect Twilio?",
      description: "Calls will revert to the operator's default number. You can reconnect anytime.",
      confirmText: "Disconnect",
      destructive: true,
    });
    if (ok) removeMutation.mutate();
  };

  const configured = !!cfg?.configured && isTwilio;
  const tokenSet = configured && !!cfg?.auth_token_set;
  const tokenHint = configured ? (cfg?.auth_token_hint ?? null) : null;
  const savedSid = configured ? (cfg?.account_sid ?? null) : null;
  const canSubmit = configured
    ? !!(accountSid || authToken || fromNumber)
    : !!(accountSid && authToken && fromNumber);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-brand" />
            Your Twilio account
          </CardTitle>
          <CardDescription>
            Bring your own Twilio so calls are billed to you and show your number.
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured && cfg ? statusBadge(cfg.status) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) saveMutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sid">
                Account SID{" "}
                {configured ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    (leave blank to keep)
                  </span>
                ) : null}
              </Label>
              <Input
                id="sid"
                value={accountSid}
                // The API returns only a masked SID, shown as the placeholder.
                placeholder={savedSid ?? "AC..."}
                onChange={(e) => setAccountSid(e.target.value)}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="from">From number</Label>
              <Input
                id="from"
                type="tel"
                value={fromNumber}
                placeholder="+14155550123"
                onChange={(e) => setFromNumber(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="token">
              Auth token{" "}
              {tokenSet ? (
                <span className="text-xs font-normal text-muted-foreground">
                  (saved{tokenHint ? `: ${tokenHint}` : ""}; leave blank to keep)
                </span>
              ) : null}
            </Label>
            <Input
              id="token"
              type="password"
              value={authToken}
              placeholder={tokenSet ? "Enter a new token to replace the saved one" : "Your Twilio auth token"}
              onChange={(e) => setAuthToken(e.target.value)}
              autoCapitalize="none"
              autoComplete="new-password"
              spellCheck={false}
            />
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
                <p className="text-sm text-muted-foreground">
                  Validate to connect this account.
                </p>
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
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
