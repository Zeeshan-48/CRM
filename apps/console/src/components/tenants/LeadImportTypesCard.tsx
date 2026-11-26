import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Loader2, Save, ShieldAlert } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateTenant } from "@/lib/api/tenants";
import { LEAD_IMPORT_TYPE_OPTIONS, type LeadImportType } from "@/lib/constants/modules";
import { cn } from "@/lib/utils";

interface LeadImportTypesCardProps {
  tenantId: string;
  allowedTypes: LeadImportType[];
  canWrite: boolean;
}

export function LeadImportTypesCard({
  tenantId,
  allowedTypes,
  canWrite,
}: LeadImportTypesCardProps) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<LeadImportType[]>(allowedTypes);

  const allowedSig = allowedTypes.slice().sort().join(",");
  React.useEffect(() => {
    setSelected(allowedTypes);
  }, [allowedSig]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = selected.slice().sort().join(",") !== allowedSig;

  const mutation = useMutation({
    mutationFn: (types: LeadImportType[]) =>
      updateTenant(tenantId, { allowed_import_types: types }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["tenant", tenantId] });
      queryClient.invalidateQueries({ queryKey: ["tenants"] });
      const count = updated.allowed_import_types?.length ?? selected.length;
      toast.success(
        count === 0
          ? "Spreadsheet import disabled for this tenant."
          : `Saved ${count} allowed import format${count === 1 ? "" : "s"}.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Could not save import formats.");
    },
  });

  const toggle = (key: LeadImportType) => {
    if (!canWrite) return;
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-brand" />
              Lead Import Formats
            </CardTitle>
            {selected.length === 0 ? (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                Blocked until enabled
              </Badge>
            ) : (
              <Badge variant="brand">
                {selected.length} enabled
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Choose which Excel / CSV formats this workspace can import. With 1 ticked, users upload
            directly using that format; with multiple ticked, workspace users pick between them.
          </p>
        </div>

        {canWrite ? (
          <Button
            size="sm"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate(selected)}
            className="gap-1.5 self-start sm:self-center"
          >
            {mutation.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Save formats
          </Button>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          {LEAD_IMPORT_TYPE_OPTIONS.map((option) => {
            const checked = selected.includes(option.key);
            const inputId = `import-format-${option.key}`;
            return (
              <div
                key={option.key}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                  canWrite ? "hover:bg-muted/40" : "opacity-80",
                  checked ? "border-brand/50 bg-brand/5" : "border-border bg-card"
                )}
              >
                <input
                  id={inputId}
                  type="checkbox"
                  checked={checked}
                  disabled={!canWrite || mutation.isPending}
                  onChange={() => toggle(option.key)}
                  className="mt-0.5 size-4 shrink-0 cursor-pointer accent-brand"
                />
                <label
                  htmlFor={inputId}
                  className={cn("min-w-0 flex-1 space-y-1", canWrite && "cursor-pointer")}
                >
                  <span className="block text-sm font-medium leading-none">{option.label}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">
                    {option.fieldsSummary}
                  </span>
                </label>
              </div>
            );
          })}
        </div>

        {selected.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <ShieldAlert className="size-4 shrink-0" />
            <span>
              No formats enabled — spreadsheet bulk import is blocked inside this CRM workspace
              until you tick and save at least one option above.
            </span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
