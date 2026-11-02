import * as React from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** A read-only label/value row used in a section card's view mode. */
export function FieldRow({
  label,
  value,
}: {
  label: string;
  value?: React.ReactNode;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">
        {empty ? <span className="text-muted-foreground">-</span> : value}
      </dd>
    </div>
  );
}

/** A section card that flips between a read-only view and an editable form. The
 *  header carries the Edit affordance (and Save / Cancel while editing). */
export function SectionCard({
  title,
  description,
  editing,
  saving,
  onEdit,
  onCancel,
  onSave,
  children,
}: {
  title: string;
  description?: string;
  editing: boolean;
  saving: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-0.5">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {editing ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" loading={saving} onClick={onSave}>
              Save
            </Button>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="shrink-0" onClick={onEdit}>
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
