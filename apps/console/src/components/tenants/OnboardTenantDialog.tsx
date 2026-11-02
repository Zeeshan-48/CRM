import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  CreditCard,
  ExternalLink,
  Loader2,
  Mail,
  MailWarning,
} from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { onboardTenant } from "@/lib/api/tenants";
import { moduleLabel } from "@/lib/constants/modules";
import { formatMoney, formatNumber, slugify } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BillingGateway, BillingMode, OnboardTenantResponse, Plan } from "@/types";

const DEFAULT_BRAND_COLOR = "#b6207f";

type Step = 1 | 2 | "success";

interface OnboardTenantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plans: Plan[];
}

interface FormState {
  name: string;
  slug: string;
  slugTouched: boolean;
  industry: string;
  domain: string;
  brandColor: string;
  planKey: string;
  gateway: string; // "NONE" | "RAZORPAY" | "STRIPE"
  billingMode: string; // "AUTO" | "MANUAL"
  adminName: string;
  adminEmail: string;
}

const INITIAL_FORM: FormState = {
  name: "",
  slug: "",
  slugTouched: false,
  industry: "",
  domain: "",
  brandColor: DEFAULT_BRAND_COLOR,
  planKey: "",
  gateway: "NONE",
  billingMode: "MANUAL",
  adminName: "",
  adminEmail: "",
};

export function OnboardTenantDialog({ open, onOpenChange, plans }: OnboardTenantDialogProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = React.useState<Step>(1);
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [result, setResult] = React.useState<OnboardTenantResponse | null>(null);

  const activePlans = plans.filter((plan) => plan.is_active);
  const selectedPlan = activePlans.find((plan) => plan.key === form.planKey);

  const patch = (changes: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...changes }));

  const mutation = useMutation({
    mutationFn: onboardTenant,
    onSuccess: (data) => {
      setResult(data);
      setStep("success");
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      queryClient.invalidateQueries({ queryKey: ["metrics-overview"] });
      toast.success(`Tenant ${data.tenant.name} onboarded`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Onboarding failed.");
    },
  });

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      // Reset after the close animation so the content does not flicker.
      setTimeout(() => {
        setStep(1);
        setForm(INITIAL_FORM);
        setResult(null);
        mutation.reset();
      }, 200);
    }
  };

  const goNext = () => {
    if (!form.name.trim()) {
      toast.error("Workspace name is required.");
      return;
    }
    if (!form.slug.trim()) {
      toast.error("Slug is required.");
      return;
    }
    if (!form.planKey) {
      toast.error("Pick a plan for this workspace.");
      return;
    }
    setStep(2);
  };

  const handleSubmit = () => {
    if (!form.adminName.trim() || !form.adminEmail.trim()) {
      toast.error("Admin name and email are required.");
      return;
    }
    mutation.mutate({
      name: form.name.trim(),
      slug: form.slug.trim(),
      ...(form.industry.trim() ? { industry: form.industry.trim() } : {}),
      ...(form.domain.trim() ? { domain: form.domain.trim() } : {}),
      brand_color: form.brandColor,
      plan_key: form.planKey,
      ...(form.gateway !== "NONE"
        ? {
            gateway: form.gateway as BillingGateway,
            billingMode: form.billingMode as BillingMode,
          }
        : {}),
      admin: {
        name: form.adminName.trim(),
        email: form.adminEmail.trim().toLowerCase(),
      },
    });
  };

  // Copies the workspace + admin email only, never a password (the temporary
  // password is emailed straight to the admin and never exposed here).
  const copyDetails = async () => {
    if (!result) return;
    const text = `Workspace: ${result.tenant.name} (${result.tenant.slug})\nAdmin email: ${result.adminUser.email}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Details copied to clipboard");
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        {step !== "success" ? (
          <DialogHeader>
            <DialogTitle>Onboard a tenant</DialogTitle>
            <DialogDescription>
              {step === 1
                ? "Step 1 of 2: workspace details and plan."
                : "Step 2 of 2: the workspace admin account."}
            </DialogDescription>
          </DialogHeader>
        ) : null}

        {/* Step indicator */}
        {step !== "success" ? (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "h-1 flex-1 rounded-full",
                step === 1 ? "bg-brand" : "bg-brand/40"
              )}
            />
            <span
              className={cn("h-1 flex-1 rounded-full", step === 2 ? "bg-brand" : "bg-muted")}
            />
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tenant-name">Workspace name</Label>
                <Input
                  id="tenant-name"
                  placeholder="Acme Industries"
                  value={form.name}
                  onChange={(event) =>
                    patch({
                      name: event.target.value,
                      ...(form.slugTouched ? {} : { slug: slugify(event.target.value) }),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenant-slug">Slug</Label>
                <Input
                  id="tenant-slug"
                  placeholder="acme-industries"
                  value={form.slug}
                  onChange={(event) =>
                    patch({ slug: slugify(event.target.value), slugTouched: true })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tenant-industry">Industry</Label>
                <Input
                  id="tenant-industry"
                  placeholder="EdTech"
                  value={form.industry}
                  onChange={(event) => patch({ industry: event.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenant-domain">Domain</Label>
                <Input
                  id="tenant-domain"
                  placeholder="acme.com"
                  value={form.domain}
                  onChange={(event) => patch({ domain: event.target.value })}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tenant-brand-color">Brand color</Label>
              <div className="flex items-center gap-2">
                <input
                  id="tenant-brand-color"
                  type="color"
                  className="h-9 w-12 cursor-pointer rounded-md border border-input bg-card p-1"
                  value={form.brandColor}
                  onChange={(event) => patch({ brandColor: event.target.value })}
                />
                <Input
                  className="font-mono"
                  value={form.brandColor}
                  onChange={(event) => patch({ brandColor: event.target.value })}
                />
                <span
                  className="size-9 shrink-0 rounded-md border"
                  style={{ backgroundColor: form.brandColor }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="onboard-plan">Plan</Label>
              <Select value={form.planKey} onValueChange={(value) => patch({ planKey: value })}>
                <SelectTrigger id="onboard-plan">
                  <SelectValue placeholder="Pick a plan" />
                </SelectTrigger>
                <SelectContent>
                  {activePlans.map((plan) => (
                    <SelectItem key={plan.key} value={plan.key}>
                      {plan.name} ({plan.key})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedPlan ? (
              <div className="border-t pt-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-sm font-semibold tracking-tight">
                    {selectedPlan.name}
                  </p>
                  <p className="text-sm tabular-nums text-muted-foreground">
                    {formatMoney(selectedPlan.price_monthly, selectedPlan.currency)}/mo
                  </p>
                </div>
                {selectedPlan.description ? (
                  <p className="mt-1 text-xs text-muted-foreground">{selectedPlan.description}</p>
                ) : null}
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {selectedPlan.modules.map((moduleKey) => (
                    <Badge key={moduleKey} variant="brand" className="text-[11px]">
                      {moduleLabel(moduleKey)}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2.5 text-xs tabular-nums text-muted-foreground">
                  {formatNumber(selectedPlan.limits.seats)} seats
                  <span className="px-1.5">&middot;</span>
                  {formatNumber(selectedPlan.limits.leads)} leads
                  <span className="px-1.5">&middot;</span>
                  {formatNumber(selectedPlan.limits.ai_credits_monthly)} AI credits/mo
                </p>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="onboard-billing">Billing</Label>
              <Select value={form.gateway} onValueChange={(value) => patch({ gateway: value })}>
                <SelectTrigger id="onboard-billing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">No billing (active immediately)</SelectItem>
                  <SelectItem value="RAZORPAY">Razorpay (payment upfront)</SelectItem>
                  <SelectItem value="STRIPE">Stripe (payment upfront)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                With a gateway the workspace stays suspended until the admin completes the first
                payment. Without one it&apos;s active immediately (comp / internal).
              </p>
            </div>

            {form.gateway !== "NONE" ? (
              <div className="space-y-1.5">
                <Label htmlFor="onboard-renewal">Renewal</Label>
                <Select value={form.billingMode} onValueChange={(value) => patch({ billingMode: value })}>
                  <SelectTrigger id="onboard-renewal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manual: admin pays a link each month</SelectItem>
                    <SelectItem value="AUTO">Auto: charge a saved card each month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={goNext} className="gap-1.5">
                Admin user
                <ArrowRight className="size-4" />
              </Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="admin-name">Admin name</Label>
              <Input
                id="admin-name"
                placeholder="Priya Sharma"
                value={form.adminName}
                onChange={(event) => patch({ adminName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-email">Admin email</Label>
              <Input
                id="admin-email"
                type="email"
                placeholder="priya@acme.example.com"
                value={form.adminEmail}
                onChange={(event) => patch({ adminEmail: event.target.value })}
              />
            </div>

            <div className="flex items-start gap-2.5 border-t pt-3 text-sm text-muted-foreground">
              <Mail className="mt-0.5 size-4 shrink-0 text-brand" />
              <p>
                A secure temporary password is generated automatically and emailed to the admin.
                They sign in with it, then set their own password from their profile. You never see
                it.
              </p>
            </div>

            <div className="flex justify-between gap-2 pt-1">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5">
                <ArrowLeft className="size-4" />
                Back
              </Button>
              <Button onClick={handleSubmit} disabled={mutation.isPending} className="gap-1.5">
                {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {mutation.isPending ? "Onboarding..." : "Onboard tenant"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "success" && result ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center pt-2 text-center">
              <span className="flex size-12 items-center justify-center text-success">
                <CheckCircle2 className="size-6" />
              </span>
              <h2 className="mt-3 font-display text-lg font-semibold tracking-tight">
                {result.tenant.name} is ready
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.checkoutUrl
                  ? "Share the payment link below. Sign-in credentials have been emailed to the admin."
                  : "Sign-in credentials have been emailed to the workspace admin."}
              </p>
            </div>

            {/* Workspace summary */}
            <div className="border-t pt-4">
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Workspace</dt>
                <dd className="min-w-0 truncate text-right font-medium">{result.tenant.name}</dd>
                <dt className="text-muted-foreground">Slug</dt>
                <dd className="min-w-0 truncate text-right font-mono text-xs">
                  {result.tenant.slug}
                </dd>
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="text-right">
                  <Badge variant="brand" className="font-mono text-[11px]">
                    {result.tenant.plan_key}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Modules</dt>
                <dd className="text-right tabular-nums">
                  {result.entitlements.filter((e) => e.code.startsWith("module.")).length} enabled
                </dd>
              </dl>
            </div>

            {/* Admin sign-in */}
            <div className="border-t pt-4">
              <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Admin sign-in
              </p>
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="min-w-0 truncate text-right font-medium">{result.adminUser.name}</dd>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="min-w-0 truncate text-right font-mono text-xs">
                  {result.adminUser.email}
                </dd>
                <dt className="text-muted-foreground">Password</dt>
                <dd className="text-right text-xs text-muted-foreground">Emailed to admin</dd>
              </dl>
            </div>

            {/* Payment link */}
            {result.checkoutUrl ? (
              <div className="space-y-2.5 border-l-2 border-warning py-1 pl-4">
                <div className="flex items-center gap-2">
                  <CreditCard className="size-4 shrink-0 text-warning" />
                  <p className="text-sm font-medium">Payment required to activate</p>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  The admin opens this secure {form.gateway === "STRIPE" ? "Stripe" : "Razorpay"}{" "}
                  link and pays, no CRM login needed. The workspace unlocks the moment the first
                  payment is confirmed, then they can sign in.
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={result.checkoutUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.checkoutUrl ?? "");
                      toast.success("Payment link copied");
                    }}
                  >
                    <Copy className="size-3.5" />
                    Copy
                  </Button>
                  <Button
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => window.open(result.checkoutUrl ?? "", "_blank", "noopener")}
                  >
                    <ExternalLink className="size-3.5" />
                    Open
                  </Button>
                </div>
              </div>
            ) : null}

            {result.emailDispatched ? (
              <div className="flex items-start gap-2.5 border-l-2 border-success py-1 pl-3 text-sm text-foreground">
                <Mail className="mt-0.5 size-4 shrink-0 text-success" />
                <p>
                  A welcome email with these sign-in details is on its way to{" "}
                  <span className="font-medium">{result.adminUser.email}</span>.
                </p>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 border-l-2 border-warning py-1 pl-3 text-sm text-foreground">
                <MailWarning className="mt-0.5 size-4 shrink-0 text-warning" />
                <p>
                  Email delivery is not configured, so the admin&apos;s temporary password
                  couldn&apos;t be sent. Configure SES on the API, then the admin sets a password
                  with &quot;Forgot password?&quot; on the sign-in page.
                </p>
              </div>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="outline" onClick={copyDetails} className="gap-1.5">
                <Copy className="size-4" />
                Copy details
              </Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => handleOpenChange(false)}>
                  Done
                </Button>
                <Button
                  onClick={() => {
                    const id = result.tenant.id;
                    handleOpenChange(false);
                    navigate(`/tenants/${id}`);
                  }}
                >
                  Open tenant
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
