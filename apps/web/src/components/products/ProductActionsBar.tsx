import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
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
import {
  invokeProductAction,
  listProductActions,
  type ProductAction,
} from "@/lib/api/products";

interface ParamField {
  key: string;
  label: string;
  type: "number" | "text";
  defaultValue: string;
  required: boolean;
}

/**
 * Reads the loose params_schema a product declared into fields we can render.
 *
 * Deliberately forgiving: a malformed entry becomes a plain text box rather
 * than breaking the dialog, because the schema comes from someone else's
 * codebase and we do not control its quality.
 */
const toFields = (schema: Record<string, unknown> | undefined): ParamField[] => {
  if (!schema || typeof schema !== "object") return [];
  return Object.entries(schema)
    .map(([key, raw]) => {
      const spec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      return {
        key,
        label: typeof spec.label === "string" ? spec.label : key.replace(/_/g, " "),
        type: spec.type === "number" ? ("number" as const) : ("text" as const),
        defaultValue:
          spec.default === undefined || spec.default === null ? "" : String(spec.default),
        required: spec.required === true,
      };
    })
    .slice(0, 8);
};

function ActionDialog({
  appId,
  appName,
  action,
  leadId,
  contactId,
  open,
  onOpenChange,
}: {
  appId: string;
  appName: string;
  action: ProductAction;
  leadId?: string;
  contactId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fields = React.useMemo(() => toFields(action.params_schema), [action]);
  const [values, setValues] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.defaultValue])));
    // Seeding only. `fields` is derived from `action`, already keyed on here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, action.key]);

  const mutation = useMutation({
    mutationFn: () =>
      invokeProductAction(appId, action.key, {
        // The server resolves the person from these ids, never from the client,
        // so an agent cannot fire an action against someone else's account.
        lead_id: leadId,
        contact_id: contactId,
        params: Object.fromEntries(
          fields.map((f) => [f.key, f.type === "number" ? Number(values[f.key]) : values[f.key]])
        ),
      }),
    onSuccess: (result) => {
      // The product's own wording is shown verbatim: it knows what it just did.
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      // The action is logged as an activity on the record, so the timeline is stale.
      void queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      void queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const missing = fields.some((f) => f.required && !String(values[f.key] ?? "").trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.label}</DialogTitle>
          <DialogDescription>
            {action.description ?? `This runs in ${appName}, not in the CRM.`}
          </DialogDescription>
        </DialogHeader>

        {fields.length > 0 ? (
          <div className="space-y-4">
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`param-${field.key}`} className="capitalize">
                  {field.label}
                </Label>
                <Input
                  id={`param-${field.key}`}
                  type={field.type}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nothing to fill in. Confirm to run it.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={missing || mutation.isPending}>
            {mutation.isPending ? "Running..." : action.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Buttons that act on the connected product from a CRM record: extend a trial,
 * issue a coupon, unlock a feature.
 *
 * Renders nothing unless a product has declared actions, so a record stays
 * clean for workspaces that have not wired this up.
 */
export function ProductActionsBar({
  leadId,
  contactId,
}: {
  leadId?: string;
  contactId?: string;
}) {
  const confirm = useConfirm();
  const [active, setActive] = React.useState<{
    appId: string;
    appName: string;
    action: ProductAction;
  } | null>(null);

  const { data } = useQuery({
    queryKey: ["product-actions"],
    queryFn: listProductActions,
  });

  const groups = data ?? [];
  if (groups.length === 0) return null;

  return (
    <div className="space-y-2 border-t pt-4">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <Zap className="size-3.5 text-muted-foreground" />
        Act on the product
      </p>

      {groups.map((group) => (
        <div key={group.app_id} className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{group.app_name}</span>
          {group.actions.map((action) => (
            <Button
              key={action.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={async () => {
                // Default to confirming: this mutates a real customer's account
                // in another system, so a stray click should not be enough.
                if (action.confirm !== false && !action.params_schema) {
                  const ok = await confirm({
                    title: action.label,
                    description:
                      action.description ??
                      `This runs "${action.label}" in ${group.app_name} for this person.`,
                    confirmText: action.label,
                  });
                  if (!ok) return;
                }
                setActive({ appId: group.app_id, appName: group.app_name, action });
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ))}

      {active ? (
        <ActionDialog
          appId={active.appId}
          appName={active.appName}
          action={active.action}
          leadId={leadId}
          contactId={contactId}
          open
          onOpenChange={(open) => {
            if (!open) setActive(null);
          }}
        />
      ) : null}
    </div>
  );
}
