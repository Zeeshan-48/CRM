import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Phone, Plus, ShieldCheck, Trash2 } from "lucide-react";
import * as React from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  allocateTenantNumber,
  getTenantTelephony,
  removeTenantNumber,
  updateTenantNumber,
  type AllocatedNumber,
} from "@/lib/api/tenants";

interface TenantTelephonyCardProps {
  tenantId: string;
  tenantName: string;
}

export function TenantTelephonyCard({
  tenantId,
  tenantName,
}: TenantTelephonyCardProps) {
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [kind, setKind] = React.useState<"MAIN" | "AGENT">("MAIN");

  const telephonyQuery = useQuery({
    queryKey: ["tenant-telephony", tenantId],
    queryFn: () => getTenantTelephony(tenantId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tenant-telephony", tenantId] });
  };

  const allocateMutation = useMutation({
    mutationFn: () =>
      allocateTenantNumber(tenantId, {
        phone,
        label: label.trim() || undefined,
        kind,
      }),
    onSuccess: (num) => {
      toast.success(`Allocated ${num.phone} to ${tenantName}`);
      setDialogOpen(false);
      setPhone("");
      setLabel("");
      setKind("MAIN");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to allocate number"),
  });

  const toggleMutation = useMutation({
    mutationFn: (num: AllocatedNumber) =>
      updateTenantNumber(tenantId, num.id, { active: !num.active }),
    onSuccess: (num) => {
      toast.success(`${num.phone} is now ${num.active ? "active" : "inactive"}`);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to toggle number"),
  });

  const removeMutation = useMutation({
    mutationFn: (numberId: string) => removeTenantNumber(tenantId, numberId),
    onSuccess: () => {
      toast.success("Number removed from tenant");
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message || "Failed to remove number"),
  });

  const data = telephonyQuery.data;
  const numbers = data?.numbers ?? [];

  return (
    <>
      <Card className="reveal">
        <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Phone className="size-4 text-brand" />
              Telephony & Virtual Numbers
            </CardTitle>
            <CardDescription className="text-xs">
              Allocate rented Plivo phone numbers to {tenantName}. Outbound calls from their
              CRM will display these caller IDs without exposing any personal numbers.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {data?.platformPlivoLive ? (
              <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-600 bg-emerald-50/50 text-[11px]">
                <ShieldCheck className="size-3" /> Master Plivo Live
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 bg-amber-50/50 text-[11px]">
                Simulation Mode
              </Badge>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDialogOpen(true)}
              className="h-8 gap-1 text-xs"
            >
              <Plus className="size-3.5" /> Allocate Number
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {telephonyQuery.isLoading ? (
            <p className="py-6 text-center text-xs text-muted-foreground">
              Loading telephony configuration...
            </p>
          ) : numbers.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center">
              <Hash className="mx-auto size-7 text-muted-foreground/40 mb-2" />
              <p className="text-sm font-medium">No numbers allocated yet</p>
              <p className="text-xs text-muted-foreground mt-0.5 max-w-sm mx-auto">
                Allocate a virtual number from your Plivo account so this tenant can place outbound calls
                and receive customer callbacks directly in their web browser.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialogOpen(true)}
                className="mt-3.5 h-8 text-xs"
              >
                <Plus className="size-3.5 mr-1" /> Allocate First Number
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-md border divide-y bg-card text-xs">
                {numbers.map((n) => (
                  <div
                    key={n.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-center gap-2.5 min-w-[200px]">
                      <span className="font-mono text-xs font-semibold text-foreground">
                        {n.phone}
                      </span>
                      <Badge
                        variant={n.kind === "MAIN" ? "default" : "secondary"}
                        className="text-[10px] px-1.5 py-0 h-4 font-normal"
                      >
                        {n.kind === "MAIN" ? "Main Caller ID" : "Agent Line"}
                      </Badge>
                    </div>

                    <div className="flex-1 min-w-[140px] text-muted-foreground">
                      <span>{n.label || "Workspace Line"}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {n.active ? "Active" : "Disabled"}
                        </span>
                        <Switch
                          checked={n.active}
                          onCheckedChange={() => toggleMutation.mutate(n)}
                          disabled={toggleMutation.isPending}
                          aria-label={`Toggle ${n.phone}`}
                        />
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        className="size-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Are you sure you want to de-allocate ${n.phone} from ${tenantName}?`
                            )
                          ) {
                            removeMutation.mutate(n.id);
                          }
                        }}
                        disabled={removeMutation.isPending}
                        aria-label={`Remove ${n.phone}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground pl-1">
                Outbound click-to-call automatically picks the tenant's Main Caller ID (or agent dedicated line).
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Allocate Number Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Allocate Virtual Number</DialogTitle>
            <DialogDescription>
              Assign a purchased Plivo number to {tenantName}. This number will serve as their
              caller ID for all browser-based CRM calls.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              allocateMutation.mutate();
            }}
            className="space-y-3.5 py-1"
          >
            <div className="space-y-1.5">
              <Label htmlFor="alloc-phone" className="text-xs font-medium">
                Phone Number (E.164 with Country Code)
              </Label>
              <Input
                id="alloc-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+911140001234 or +14155550123"
                className="font-mono text-xs"
                required
              />
              <p className="text-[11px] text-muted-foreground">
                Must be an active number rented on your Master Plivo account.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alloc-label" className="text-xs font-medium">
                Label / Purpose
              </Label>
              <Input
                id="alloc-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Admissions Hotline, Sales Desk"
                className="text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alloc-kind" className="text-xs font-medium">
                Number Role
              </Label>
              <Select
                value={kind}
                onValueChange={(v: "MAIN" | "AGENT") => setKind(v)}
              >
                <SelectTrigger id="alloc-kind" className="text-xs h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MAIN" className="text-xs">
                    Main Line (Company Caller ID for all agents)
                  </SelectItem>
                  <SelectItem value="AGENT" className="text-xs">
                    Agent Line (Dedicated line for specific rep)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!phone.trim() || allocateMutation.isPending}
              >
                {allocateMutation.isPending ? "Allocating..." : "Allocate to Tenant"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
