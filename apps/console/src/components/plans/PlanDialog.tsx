import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { createPlan, updatePlan } from "@/lib/api/plans";
import { MODULES, moduleLabel } from "@/lib/constants/modules";
import { cn } from "@/lib/utils";
import type { Plan } from "@/types";

const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this plan; otherwise it creates a new one. */
  plan: Plan | null;
}

interface FormState {
  key: string;
  name: string;
  description: string;
  price: string;
  modules: string[];
  seats: string;
  leads: string;
  aiCredits: string;
}

const EMPTY_FORM: FormState = {
  key: "",
  name: "",
  description: "",
  price: "0",
  modules: [],
  seats: "5",
  leads: "1000",
  aiCredits: "500",
};

const formFromPlan = (plan: Plan): FormState => ({
  key: plan.key,
  name: plan.name,
  description: plan.description ?? "",
  price: String(plan.price_monthly),
  modules: [...plan.modules],
  seats: String(plan.limits.seats ?? 0),
  leads: String(plan.limits.leads ?? 0),
  aiCredits: String(plan.limits.ai_credits_monthly ?? 0),
});

export function PlanDialog({ open, onOpenChange, plan }: PlanDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = plan !== null;
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);

  // Re-seed the form whenever the dialog opens for a different plan.
  React.useEffect(() => {
    if (open) setForm(plan ? formFromPlan(plan) : EMPTY_FORM);
  }, [open, plan]);

  const patch = (changes: Partial<FormState>) =>
    setForm((prev) => ({ ...prev, ...changes }));

  const toggleModule = (moduleKey: string) =>
    setForm((prev) => ({
      ...prev,
      modules: prev.modules.includes(moduleKey)
        ? prev.modules.filter((m) => m !== moduleKey)
        : [...prev.modules, moduleKey],
    }));

  const mutation = useMutation({
    mutationFn: (payload: {
      key: string;
      name: string;
      description?: string;
      price_monthly: number;
      modules: string[];
      limits: { seats: number; leads: number; ai_credits_monthly: number };
    }) =>
      isEdit
        ? updatePlan(plan.id, {
            name: payload.name,
            description: payload.description ?? null,
            price_monthly: payload.price_monthly,
            modules: payload.modules,
            limits: payload.limits,
          })
        : createPlan(payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["plans"] });
      toast.success(isEdit ? `Plan ${saved.key} updated` : `Plan ${saved.key} created`);
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Saving the plan failed.");
    },
  });

  const handleSubmit = () => {
    const key = form.key.trim();
    if (!isEdit && !PLAN_KEY_PATTERN.test(key)) {
      toast.error("Key must be UPPER_SNAKE_CASE (letters, digits, underscores).");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Name is required.");
      return;
    }
    const price = parseInt(form.price, 10);
    if (!Number.isInteger(price) || price < 0) {
      toast.error("Price must be a non-negative integer.");
      return;
    }
    if (form.modules.length === 0) {
      toast.error("Pick at least one module.");
      return;
    }
    const seats = parseInt(form.seats, 10);
    const leads = parseInt(form.leads, 10);
    const aiCredits = parseInt(form.aiCredits, 10);
    for (const [label, value] of [
      ["Seats", seats],
      ["Leads", leads],
      ["AI credits", aiCredits],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        toast.error(`${label} must be a non-negative integer.`);
        return;
      }
    }

    mutation.mutate({
      key,
      name: form.name.trim(),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      price_monthly: price,
      modules: form.modules,
      limits: { seats, leads, ai_credits_monthly: aiCredits },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Edit plan ${plan.key}` : "New plan"}</DialogTitle>
          <DialogDescription>
            Plans are sales artifacts. Editing a plan never changes the entitlements of
            tenants already on it; only new snapshots pick up the changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plan-key">Key</Label>
              <Input
                id="plan-key"
                placeholder="GROWTH"
                className="font-mono"
                value={form.key}
                disabled={isEdit}
                onChange={(event) => patch({ key: event.target.value.toUpperCase() })}
              />
              {!isEdit ? (
                <p className="text-xs text-muted-foreground">
                  UPPER_SNAKE_CASE, immutable after creation.
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">Name</Label>
              <Input
                id="plan-name"
                placeholder="Growth"
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-description">Description</Label>
            <Textarea
              id="plan-description"
              placeholder="For scaling teams that need automation and AI."
              value={form.description}
              onChange={(event) => patch({ description: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plan-price">Price (INR / month)</Label>
            <Input
              id="plan-price"
              type="number"
              min={0}
              className="w-44 tabular-nums"
              value={form.price}
              onChange={(event) => patch({ price: event.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>
              Modules{" "}
              <span className="font-normal tabular-nums text-muted-foreground">
                ({form.modules.length} of {MODULES.length})
              </span>
            </Label>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {MODULES.map((moduleKey) => {
                const selected = form.modules.includes(moduleKey);
                return (
                  <button
                    key={moduleKey}
                    type="button"
                    onClick={() => toggleModule(moduleKey)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-left text-xs font-medium transition-colors duration-120",
                      selected
                        ? "border-brand/50 bg-brand/15 text-foreground"
                        : "border-input bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                        selected ? "border-brand bg-brand text-brand-foreground" : "border-input"
                      )}
                    >
                      {selected ? <Check className="size-2.5" /> : null}
                    </span>
                    {moduleLabel(moduleKey)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-seats">Seats</Label>
              <Input
                id="plan-seats"
                type="number"
                min={0}
                className="tabular-nums"
                value={form.seats}
                onChange={(event) => patch({ seats: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-leads">Leads</Label>
              <Input
                id="plan-leads"
                type="number"
                min={0}
                className="tabular-nums"
                value={form.leads}
                onChange={(event) => patch({ leads: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-ai-credits">AI credits / month</Label>
              <Input
                id="plan-ai-credits"
                type="number"
                min={0}
                className="tabular-nums"
                value={form.aiCredits}
                onChange={(event) => patch({ aiCredits: event.target.value })}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="gap-1.5">
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create plan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
