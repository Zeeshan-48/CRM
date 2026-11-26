import { CheckCircle2, Mail, Phone, Search, Shield, Users } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
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
import { moduleLabel } from "@/lib/constants/modules";
import { formatDate, formatDateTime } from "@/lib/format";

export interface VaultRoleMember {
  id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  status?: string | null;
}

export interface VaultRoleRecord {
  id: string;
  tenant_id: string;
  tenant_name?: string | null;
  key: string;
  name: string;
  description?: string | null;
  builtin?: boolean;
  permissions?: unknown;
  members?: unknown;
  member_count?: number | null;
  created_at?: string | null;
  deleted_at?: string | null;
}

interface RoleDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: VaultRoleRecord | null;
  tenantName: string;
}

const getInitials = (name: string | null | undefined, email: string | null | undefined) => {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
};

export function RoleDetailsDialog({
  open,
  onOpenChange,
  role,
  tenantName,
}: RoleDetailsDialogProps) {
  const [filterText, setFilterText] = React.useState("");

  React.useEffect(() => {
    if (!open) setFilterText("");
  }, [open, role?.id]);

  if (!role) return null;

  const perms = Array.isArray(role.permissions)
    ? role.permissions.filter((p): p is string => typeof p === "string")
    : [];
  const hasWildcard = perms.includes("*");
  const members = Array.isArray(role.members)
    ? (role.members as VaultRoleMember[])
    : [];
  const memberCount = role.member_count ?? members.length;
  const isDeleted = Boolean(role.deleted_at);

  const q = filterText.trim().toLowerCase();
  const visiblePerms = q
    ? perms.filter(
        (p) => p.toLowerCase().includes(q) || moduleLabel(p).toLowerCase().includes(q)
      )
    : perms;
  const visibleMembers = q
    ? members.filter(
        (m) =>
          (m.name || "").toLowerCase().includes(q) ||
          (m.email || "").toLowerCase().includes(q) ||
          (m.phone || "").toLowerCase().includes(q)
      )
    : members;

  const showSearch = members.length + perms.length > 6;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader className="space-y-2 pr-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
              <Shield className="size-4" />
            </span>
            <DialogTitle className="text-lg">{role.name}</DialogTitle>
            <Badge variant={role.builtin ? "secondary" : "outline"} className="text-[11px]">
              {role.builtin ? "Built-in System Role" : "Custom Admin Role"}
            </Badge>
            {isDeleted ? (
              <Badge variant="destructive" className="text-[11px]">
                DELETED (VAULT)
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 text-[11px]">
                <CheckCircle2 className="size-3 text-emerald-500" />
                ACTIVE
              </Badge>
            )}
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-semibold text-foreground">{tenantName}</span>
            <span>&middot;</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-brand">
              {role.key}
            </span>
            <span>&middot;</span>
            <span>
              {role.builtin
                ? "System Default"
                : role.created_at
                  ? `Created ${formatDate(role.created_at)}`
                  : "—"}
            </span>
            {role.deleted_at ? (
              <>
                <span>&middot;</span>
                <span className="text-destructive">
                  Deleted {formatDateTime(role.deleted_at)}
                </span>
              </>
            ) : null}
          </DialogDescription>
          {role.description ? (
            <p className="text-xs text-muted-foreground">{role.description}</p>
          ) : null}
        </DialogHeader>

        {showSearch ? (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="Filter members or modules..."
              className="h-8 pl-8 text-xs"
            />
          </div>
        ) : null}

        <div className="space-y-4">
          {/* Permissions / Modules */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Shield className="size-3.5 text-brand" />
                Permissions / Modules ({hasWildcard ? "All" : perms.length})
              </h3>
            </div>
            {hasWildcard ? (
              <div className="rounded-lg border border-brand/30 bg-brand/5 px-3 py-2 text-xs text-foreground">
                <span className="font-semibold text-brand">All Modules (*)</span> — Full access
                across every CRM workspace module.
              </div>
            ) : visiblePerms.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 rounded-lg border bg-muted/20 p-3">
                {visiblePerms.map((p) => (
                  <Badge key={p} variant="secondary" className="gap-1.5 px-2 py-0.5 text-xs">
                    <span className="font-medium text-foreground">{moduleLabel(p)}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{p}</span>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground italic">
                {perms.length === 0 ? "No modules assigned." : "No modules match your search."}
              </p>
            )}
          </section>

          {/* Assigned Members */}
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Users className="size-3.5 text-brand" />
              Assigned Members ({memberCount})
            </h3>
            {visibleMembers.length > 0 ? (
              <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visibleMembers.map((u, idx) => (
                  <div
                    key={u.id || u.email || idx}
                    className="flex items-start gap-2.5 rounded-lg border bg-card p-2.5 shadow-xs"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold text-brand">
                      {getInitials(u.name, u.email)}
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {u.name || "Unnamed user"}
                        </span>
                        {u.status && u.status !== "ACTIVE" ? (
                          <Badge variant="outline" className="shrink-0 px-1 py-0 text-[9px]">
                            {u.status}
                          </Badge>
                        ) : null}
                      </div>
                      {u.email ? (
                        <p className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                          <Mail className="size-3 shrink-0 opacity-70" />
                          <span className="truncate">{u.email}</span>
                        </p>
                      ) : null}
                      {u.phone ? (
                        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Phone className="size-3 shrink-0 opacity-70" />
                          <span>{u.phone}</span>
                        </p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed px-3 py-3 text-xs text-muted-foreground italic">
                {memberCount === 0
                  ? "No workspace users are currently assigned to this role."
                  : "No assigned members match your search."}
              </p>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
