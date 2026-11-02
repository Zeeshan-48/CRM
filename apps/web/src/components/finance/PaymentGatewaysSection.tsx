import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { GatewayLogo } from "@/components/finance/GatewayLogo";
import { RazorpayConnectionCard } from "@/components/finance/RazorpayConnectionCard";
import { StripeConnectionCard } from "@/components/finance/StripeConnectionCard";
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
  getGatewayDefault,
  getRazorpayConfig,
  getStripeConfig,
  setGatewayDefault,
  type GatewayName,
  type RazorpayStatus,
} from "@/lib/api/finance";
import { cn } from "@/lib/utils";

const OPTIONS: GatewayName[] = ["Razorpay", "Stripe"];

function statusMeta(cfg?: { status: RazorpayStatus; configured: boolean }): {
  label: string;
  dot: string;
} {
  if (!cfg) return { label: "Loading…", dot: "bg-muted-foreground/40" };
  if (cfg.status === "ACTIVE") return { label: "Connected", dot: "bg-success" };
  if (cfg.status === "DISABLED")
    return { label: "Disabled", dot: "bg-muted-foreground" };
  if (cfg.configured) return { label: "Needs validation", dot: "bg-warning" };
  return { label: "Not connected", dot: "bg-muted-foreground/40" };
}

// Payment gateway settings: pick one provider to view/configure at a time, so
// the page isn't cluttered with both. The tenant default (which gateway new
// links use) is preserved and surfaced contextually for the selected provider.
export function PaymentGatewaysSection() {
  const queryClient = useQueryClient();
  const defaultQuery = useQuery({
    queryKey: ["gateway-default"],
    queryFn: getGatewayDefault,
  });
  // Both configs power the selector's live status dots. These share the exact
  // query keys the connection cards use, so react-query dedupes the fetches.
  const rzpQuery = useQuery({
    queryKey: ["razorpay-config"],
    queryFn: getRazorpayConfig,
  });
  const stripeQuery = useQuery({
    queryKey: ["stripe-config"],
    queryFn: getStripeConfig,
  });
  const current = defaultQuery.data?.gateway ?? "Razorpay";

  // Which provider is being viewed/configured. Defaults to the tenant default
  // once it loads; selecting a provider only changes the view, not the default.
  const [selected, setSelected] = React.useState<GatewayName | null>(null);
  React.useEffect(() => {
    if (selected === null && defaultQuery.data?.gateway)
      setSelected(defaultQuery.data.gateway);
  }, [defaultQuery.data, selected]);
  const view: GatewayName = selected ?? current;

  const setMutation = useMutation({
    mutationFn: (gateway: GatewayName) => setGatewayDefault(gateway),
    onSuccess: (data) => {
      toast.success(`New payment links now use ${data.gateway}.`);
      queryClient.invalidateQueries({ queryKey: ["gateway-default"] });
    },
    onError: (e: Error) =>
      toast.error(e.message || "Could not update the default gateway."),
  });

  const cfgFor = (name: GatewayName) =>
    name === "Razorpay" ? rzpQuery.data : stripeQuery.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <CardTitle>Payment gateways</CardTitle>
          <CardDescription>
            Pick a provider to set up. Each payment keeps its own gateway, so
            refunds always go back through the one that took it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {OPTIONS.map((name) => {
              const active = view === name;
              const meta = statusMeta(cfgFor(name));
              const isDefault = current === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelected(name)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all duration-200",
                    active
                      ? "border-brand/50 bg-brand/[0.04] ring-2 ring-brand/15"
                      : "hover:border-foreground/20 hover:bg-muted/40",
                  )}
                >
                  <GatewayLogo name={name} size={40} className="" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      {isDefault ? (
                        <Badge
                          variant="brand"
                          className="text-[10px]"
                        >
                          Default
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 rounded-full", meta.dot)} />
                      {meta.label}
                    </div>
                  </div>
                  {active ? (
                    <Check className="size-4 shrink-0 text-brand" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {view === current ? (
            <p className="text-xs text-muted-foreground">
              New payment links collect via{" "}
              <span className="font-medium text-foreground">{current}</span>.
            </p>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3.5 py-2.5">
              <p className="text-sm text-muted-foreground">
                New links currently use{" "}
                <span className="font-medium text-foreground">{current}</span>.
              </p>
              <Button
                size="sm"
                variant="outline"
                loading={setMutation.isPending}
                onClick={() => setMutation.mutate(view)}
              >
                Use {view} for new links
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Only the selected provider's connection card renders. */}
      {view === "Razorpay" ? <RazorpayConnectionCard /> : <StripeConnectionCard />}
    </div>
  );
}
