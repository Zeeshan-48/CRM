import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Briefcase,
  ChevronDown,
  Clock,
  Crown,
  Headset,
  KeyRound,
  type LucideIcon,
  Megaphone,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Shield,
  ShieldCheck,
  ShieldPlus,
  Trash2,
  UserCheck,
  UserCog,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TagInput } from "@/components/ui/tag-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getLeadSources } from "@/lib/api/leads";
import {
  createCustomRole,
  createUser,
  deleteCustomRole,
  deleteUser,
  getRolesCatalogue,
  listUsers,
  resetUserPassword,
  updateCustomRole,
  updateUser,
  type CrmUser,
  type ModuleMeta,
  type UserDeletionReport,
} from "@/lib/api/users";
import { initials, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { hasModule, useAuthStore } from "@/stores/auth-store";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "text-success",
  DISABLED: "text-danger",
  PENDING: "text-warning",
};

// Icon + one-line description for each built-in role. Custom roles fall back to
// a generic shield.
const ROLE_META: Record<string, { icon: LucideIcon; blurb: string }> = {
  ADMIN: { icon: Crown, blurb: "Full access to every module, plus settings, billing and audit." },
  MANAGER: {
    icon: UserCog,
    blurb: "Runs the team and all CRM modules except billing, integrations and audit.",
  },
  SALES_AGENT: {
    icon: Briefcase,
    blurb: "Works leads, deals and contacts through the sales pipeline.",
  },
  SUPPORT_AGENT: { icon: Headset, blurb: "Handles support tickets and customer conversations." },
  MARKETING_AGENT: {
    icon: Megaphone,
    blurb: "Runs campaigns, journeys and email / WhatsApp outreach.",
  },
  HR: { icon: Users, blurb: "Access to the knowledge base and calendar." },
  FINANCE: { icon: Wallet, blurb: "Invoicing, payments and financial analytics." },
};

// Friendlier labels for a few module keys; everything else is title-cased.
// (The role editor's picker gets its labels from the backend catalogue; this
// map covers the compact chips shown elsewhere, including governance caps.)
const MODULE_LABELS: Record<string, string> = {
  kb: "Knowledge Base",
  whatsapp: "WhatsApp",
  copilot: "Copilot",
  voice: "Voice",
  agents: "AI Agents",
  deals: "Pipeline",
  channels: "Channel Setup",
  team: "Users & Roles",
  billing: "Billing",
  settings: "Workspace Settings",
  integrations: "Integrations & API",
  audit: "Audit & Compliance",
};

// Elevated roles: only an actual ADMIN may invite, edit, reassign or delete
// their users, or edit the role's modules. Mirrors the backend ELEVATED_ROLES.
const ELEVATED_ROLES = ["ADMIN", "MANAGER"];

// Labels for the entities reassigned when a user is deleted (keys match the
// backend deletion report).
const ENTITY_LABELS: Record<string, string> = {
  leads: "Leads",
  deals: "Deals",
  tasks: "Tasks",
  activities: "Activities",
  contacts: "Contacts",
  accounts: "Accounts",
  meetings: "Meetings",
  bookingLinks: "Booking links",
  tickets: "Tickets",
};

const roleLabel = (role: string): string =>
  role
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const moduleLabel = (key: string): string =>
  key === "*"
    ? "All modules"
    : (MODULE_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1));

function ChipList({ items, tone }: { items: string[]; tone: "muted" | "outline" }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 2);
  const rest = items.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((item) => (
        <span
          key={item}
          className={cn(
            "inline-flex items-center text-xs",
            tone === "muted" ? "text-muted-foreground" : "text-foreground"
          )}
        >
          {item}
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-xs tabular-nums text-muted-foreground">+{rest}</span>
      ) : null}
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <span className={cn("flex size-8 items-center justify-center rounded-md", accent)}>
          <Icon className="size-4" />
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums tracking-tight">
        {value}
      </p>
    </div>
  );
}

function ModuleChips({ modules }: { modules: string[] }) {
  if (modules.includes("*")) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-brand">
        <ShieldCheck className="size-3" />
        All modules
      </span>
    );
  }
  if (modules.length === 0) {
    return <span className="text-xs text-muted-foreground">No module access</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {modules.map((key) => (
        <span
          key={key}
          className="inline-flex items-center text-xs text-muted-foreground"
        >
          {moduleLabel(key)}
        </span>
      ))}
    </div>
  );
}

// Grouped module/capability picker for the role editor. Options + grouping come
// straight from the backend catalogue so it never drifts from the real module
// registry; governance capabilities are flagged with an "admin" tag.
function RolePermissionPicker({
  catalogue,
  selected,
  onToggle,
}: {
  catalogue: ModuleMeta[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  const groups = React.useMemo(() => {
    const map = new Map<string, ModuleMeta[]>();
    for (const meta of catalogue) {
      const arr = map.get(meta.group) ?? [];
      arr.push(meta);
      map.set(meta.group, arr);
    }
    return Array.from(map.entries());
  }, [catalogue]);

  return (
    <div className="max-h-72 space-y-3 overflow-y-auto rounded-md border p-3">
      {groups.map(([group, items]) => (
        <div key={group} className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </p>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {items.map((meta) => (
              <label
                key={meta.key}
                title={meta.description}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-120 hover:bg-muted"
              >
                <input
                  type="checkbox"
                  className="size-3.5 accent-brand"
                  checked={selected.includes(meta.key)}
                  onChange={() => onToggle(meta.key)}
                />
                <span className="truncate">{meta.label}</span>
                {meta.governance ? (
                  <span className="ml-auto rounded bg-muted px-1 text-[10px] font-medium uppercase text-muted-foreground">
                    admin
                  </span>
                ) : null}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  // All user/role management on this page is governed by the `team` capability
  // (the page itself is route-guarded on it), not by hardcoded role names.
  const canManageTeam = me ? hasModule(me, "team") : false;
  // Elevated (admin/manager) roles + their users are ADMIN-only, even for a
  // manager who holds the team capability.
  const isAdmin = me?.role === "ADMIN";
  const canManageUser = (u: CrmUser): boolean =>
    canManageTeam && (isAdmin || !ELEVATED_ROLES.includes(u.role));
  const canManageRole = (key: string): boolean =>
    canManageTeam && key !== "ADMIN" && (isAdmin || key !== "MANAGER");

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });
  const rolesQuery = useQuery({ queryKey: ["roles-catalogue"], queryFn: getRolesCatalogue });
  // Lead sources double as the "skills" vocabulary, an agent's skills are the
  // lead sources they handle, which is what SKILL_BASED assignment matches on.
  const sourcesQuery = useQuery({ queryKey: ["lead-sources"], queryFn: getLeadSources });

  const users = React.useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const catalogue = rolesQuery.data;
  // Built-in roles this actor may assign: a non-admin can't hand out ADMIN/MANAGER.
  const assignableBuiltins = (catalogue?.builtin ?? []).filter(
    (r) => isAdmin || !ELEVATED_ROLES.includes(r)
  );
  const leadSources = sourcesQuery.data ?? [];

  // Members per role key (built-in role keys + custom role keys).
  const countByRole = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const user of users) counts[user.role] = (counts[user.role] ?? 0) + 1;
    return counts;
  }, [users]);

  // Effective module access for a role key: built-in from roleModules, custom
  // from the role's permissions.
  const modulesForRoleKey = React.useCallback(
    (key: string): string[] =>
      catalogue?.roleModules[key] ??
      catalogue?.custom.find((role) => role.key === key)?.permissions ??
      [],
    [catalogue]
  );

  // A member's effective modules: an explicit per-user permission override wins,
  // otherwise it resolves from their role.
  const memberModules = React.useCallback(
    (user: CrmUser): string[] =>
      user.permissions.length > 0 ? user.permissions : modulesForRoleKey(user.role),
    [modulesForRoleKey]
  );

  // Every role in the workspace, built-in first, then custom, for the roles grid.
  const roleViews = React.useMemo(() => {
    if (!catalogue) return [];
    return [
      ...catalogue.builtin.map((key) => ({
        key,
        name: roleLabel(key),
        kind: "Built-in" as const,
        modules: catalogue.roleModules[key] ?? [],
      })),
      ...catalogue.custom.map((role) => ({
        key: role.key,
        name: role.name,
        kind: "Custom" as const,
        modules: role.permissions,
      })),
    ];
  }, [catalogue]);

  const activeCount = users.filter((u) => u.status === "ACTIVE").length;
  const pendingCount = users.filter((u) => u.status === "PENDING").length;

  // ---- Invite user dialog ----
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteName, setInviteName] = React.useState("");
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState("");
  const [invitePassword, setInvitePassword] = React.useState("");
  const [inviteTerritory, setInviteTerritory] = React.useState<string[]>([]);
  const [inviteSkills, setInviteSkills] = React.useState<string[]>([]);

  const inviteMutation = useMutation({
    mutationFn: createUser,
    onSuccess: (created) => {
      toast.success(
        created.emailed
          ? `${created.name} invited, sign-in details emailed to ${created.email}.`
          : `${created.name} invited to the workspace.`
      );
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setInviteOpen(false);
      setInviteName("");
      setInviteEmail("");
      setInviteRole("");
      setInvitePassword("");
      setInviteTerritory([]);
      setInviteSkills([]);
    },
    onError: (error) => toast.error(error.message),
  });

  const submitInvite = (event: React.FormEvent) => {
    event.preventDefault();
    if (!inviteName.trim() || !inviteEmail.trim() || !inviteRole) {
      toast.error("Name, email and role are required.");
      return;
    }
    inviteMutation.mutate({
      name: inviteName.trim(),
      email: inviteEmail.trim(),
      role: inviteRole,
      ...(invitePassword ? { password: invitePassword } : {}),
      ...(inviteTerritory.length ? { territory: inviteTerritory } : {}),
      ...(inviteSkills.length ? { skills: inviteSkills } : {}),
    });
  };

  // ---- Edit member (territory & skills) dialog ----
  const [editUser, setEditUser] = React.useState<CrmUser | null>(null);
  const [editUserRole, setEditUserRole] = React.useState("");
  const [editTerritory, setEditTerritory] = React.useState<string[]>([]);
  const [editSkills, setEditSkills] = React.useState<string[]>([]);
  const [editPhone, setEditPhone] = React.useState("");

  const openEdit = (user: CrmUser) => {
    setEditUser(user);
    setEditUserRole(user.role);
    setEditTerritory(user.territory);
    setEditSkills(user.skills);
    setEditPhone(user.phone ?? "");
  };

  const editMutation = useMutation({
    mutationFn: (payload: {
      id: string;
      role: string;
      territory: string[];
      skills: string[];
      phone: string;
    }) =>
      updateUser(payload.id, {
        role: payload.role,
        territory: payload.territory,
        skills: payload.skills,
        phone: payload.phone,
      }),
    onSuccess: (updated) => {
      toast.success(`${updated.name} updated.`);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditUser(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const submitEdit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editUser) return;
    editMutation.mutate({
      id: editUser.id,
      role: editUserRole,
      territory: editTerritory,
      skills: editSkills,
      phone: editPhone.trim(),
    });
  };

  // ---- Reset password (admin) ----
  const [resetTarget, setResetTarget] = React.useState<CrmUser | null>(null);

  const resetMutation = useMutation({
    mutationFn: (id: string) => resetUserPassword(id),
    onSuccess: (result) => {
      if (result.emailed) {
        toast.success(`New password emailed to ${result.email}.`);
      } else {
        toast.warning(
          "Password was reset, but email isn't configured, the member won't receive it. Configure email sending first."
        );
      }
      setResetTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  // ---- Status update ----
  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CrmUser["status"] }) =>
      updateUser(id, { status }),
    onSuccess: (updated) => {
      toast.success(
        updated.status === "ACTIVE" ? `${updated.name} activated.` : `${updated.name} disabled.`
      );
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => toast.error(error.message),
  });

  // ---- New custom role dialog ----
  const [roleOpen, setRoleOpen] = React.useState(false);
  const [roleName, setRoleName] = React.useState("");
  const [roleModules, setRoleModules] = React.useState<string[]>([]);

  const roleMutation = useMutation({
    mutationFn: createCustomRole,
    onSuccess: (created) => {
      toast.success(`Role "${created.name}" created.`);
      queryClient.invalidateQueries({ queryKey: ["roles-catalogue"] });
      setRoleOpen(false);
      setRoleName("");
      setRoleModules([]);
    },
    onError: (error) => toast.error(error.message),
  });

  const toggleRoleModule = (moduleKey: string) => {
    setRoleModules((current) =>
      current.includes(moduleKey)
        ? current.filter((m) => m !== moduleKey)
        : [...current, moduleKey]
    );
  };

  const submitRole = (event: React.FormEvent) => {
    event.preventDefault();
    if (!roleName.trim()) {
      toast.error("Give the role a name.");
      return;
    }
    if (roleModules.length === 0) {
      toast.error("Pick at least one module.");
      return;
    }
    roleMutation.mutate({ name: roleName.trim(), permissions: roleModules });
  };

  // ---- Edit role dialog (custom roles + non-ADMIN built-ins) ----
  const isCustomized = (key: string): boolean => catalogue?.customized?.includes(key) ?? false;

  const [editRole, setEditRole] = React.useState<{
    key: string;
    name: string;
    builtin: boolean;
  } | null>(null);
  const [editRoleName, setEditRoleName] = React.useState("");
  const [editRoleModules, setEditRoleModules] = React.useState<string[]>([]);

  const openEditRole = (role: { key: string; name: string; kind: string; modules: string[] }) => {
    setEditRole({ key: role.key, name: role.name, builtin: role.kind === "Built-in" });
    setEditRoleName(role.name);
    setEditRoleModules(role.modules);
  };

  const toggleEditRoleModule = (moduleKey: string) => {
    setEditRoleModules((current) =>
      current.includes(moduleKey)
        ? current.filter((m) => m !== moduleKey)
        : [...current, moduleKey]
    );
  };

  const updateRoleMutation = useMutation({
    mutationFn: (payload: { key: string; name?: string; permissions: string[] }) =>
      updateCustomRole(
        payload.key,
        payload.name !== undefined
          ? { name: payload.name, permissions: payload.permissions }
          : { permissions: payload.permissions }
      ),
    onSuccess: (updated) => {
      toast.success(`Role "${updated.name}" updated.`);
      queryClient.invalidateQueries({ queryKey: ["roles-catalogue"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setEditRole(null);
    },
    onError: (error) => toast.error(error.message),
  });

  const submitEditRole = (event: React.FormEvent) => {
    event.preventDefault();
    if (!editRole) return;
    if (editRoleModules.length === 0) {
      toast.error("Pick at least one module.");
      return;
    }
    if (!editRole.builtin && !editRoleName.trim()) {
      toast.error("Give the role a name.");
      return;
    }
    updateRoleMutation.mutate({
      key: editRole.key,
      ...(editRole.builtin ? {} : { name: editRoleName.trim() }),
      permissions: editRoleModules,
    });
  };

  // ---- Delete a custom role / reset a built-in role to default ----
  const [deleteRoleTarget, setDeleteRoleTarget] = React.useState<{
    key: string;
    name: string;
    builtin: boolean;
  } | null>(null);

  const deleteRoleMutation = useMutation({
    mutationFn: (key: string) => deleteCustomRole(key),
    onSuccess: () => {
      toast.success(deleteRoleTarget?.builtin ? "Role reset to default." : "Role deleted.");
      queryClient.invalidateQueries({ queryKey: ["roles-catalogue"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteRoleTarget(null);
    },
    onError: (error) => toast.error(error.message),
  });

  // ---- Remove a user (reassigns their owned work, then shows a report) ----
  const [deleteUserTarget, setDeleteUserTarget] = React.useState<CrmUser | null>(null);
  const [deleteReport, setDeleteReport] = React.useState<UserDeletionReport | null>(null);

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: (report) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["roles-catalogue"] });
      setDeleteUserTarget(null);
      setDeleteReport(report);
    },
    onError: (error) => toast.error(error.message),
  });

  const selectedRoleModules = inviteRole ? modulesForRoleKey(inviteRole) : [];
  const usersLoading = usersQuery.isLoading;
  const rolesLoading = rolesQuery.isLoading;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6">
        <PageHeader
          title="Users & Roles"
          description="Manage your team, their status and what each role can access."
          actions={
            <>
              {canManageTeam ? (
                <Button variant="outline" onClick={() => setRoleOpen(true)}>
                  <ShieldPlus />
                  New Role
                </Button>
              ) : null}
              {canManageTeam ? (
                <Button onClick={() => setInviteOpen(true)}>
                  <UserPlus />
                  Invite User
                </Button>
              ) : null}
            </>
          }
        />

        {/* Summary stats */}
        <section className="reveal grid grid-cols-2 gap-3 lg:grid-cols-4">
          {usersLoading || rolesLoading ? (
            Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-lg" />)
          ) : (
            <>
              <StatTile icon={Users} label="Members" value={users.length} accent="bg-brand/10 text-brand" />
              <StatTile
                icon={UserCheck}
                label="Active"
                value={activeCount}
                accent="bg-success/12 text-success"
              />
              <StatTile
                icon={Clock}
                label="Pending"
                value={pendingCount}
                accent="bg-warning/12 text-warning"
              />
              <StatTile
                icon={Shield}
                label="Roles"
                value={roleViews.length}
                accent="bg-neutral/12 text-neutral"
              />
            </>
          )}
        </section>

        {/* Team table */}
        <section className="reveal" style={{ animationDelay: "60ms" }}>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Team members</CardTitle>
              {!usersLoading ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {users.length} {users.length === 1 ? "member" : "members"}
                </span>
              ) : null}
            </CardHeader>
            <CardContent className="px-0 pb-2">
              {usersLoading ? (
                <div className="space-y-3 px-5 pb-4 pt-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <Skeleton className="size-9 shrink-0 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-40" />
                        <Skeleton className="h-3 w-56" />
                      </div>
                      <Skeleton className="h-6 w-20 rounded-full" />
                      <Skeleton className="hidden h-6 w-16 rounded-full sm:block" />
                      <Skeleton className="hidden h-3 w-14 md:block" />
                    </div>
                  ))}
                </div>
              ) : users.length === 0 ? (
                <div className="px-5 pb-5">
                  <EmptyState
                    icon={UserCog}
                    title="No team members yet"
                    description="Invite your first teammate to start collaborating."
                    action={
                      canManageTeam ? (
                        <Button onClick={() => setInviteOpen(true)}>
                          <UserPlus />
                          Invite User
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Member</TableHead>
                        <TableHead>Role</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Access</TableHead>
                        <TableHead>Territory &amp; skills</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead className="text-right">Last login</TableHead>
                        {canManageTeam ? (
                          <TableHead className="w-10 text-right">
                            <span className="sr-only">Actions</span>
                          </TableHead>
                        ) : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((user) => {
                        const modules = memberModules(user);
                        const fullAccess = modules.includes("*");
                        return (
                          <TableRow key={user.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <span
                                  className={cn(
                                    "flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white",
                                    !user.avatar_color && "bg-brand"
                                  )}
                                  style={
                                    user.avatar_color
                                      ? { backgroundColor: user.avatar_color }
                                      : undefined
                                  }
                                >
                                  {initials(user.name)}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium">
                                    {user.name}
                                    {user.id === me?.id ? (
                                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                        (you)
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {user.email}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="brand">{roleLabel(user.role)}</Badge>
                            </TableCell>
                            <TableCell>
                              {canManageUser(user) && user.id !== me?.id ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-md border px-2.5 py-0.5 text-xs font-medium transition-colors duration-120 hover:bg-muted",
                                        STATUS_STYLES[user.status] ?? "bg-muted"
                                      )}
                                    >
                                      {user.status}
                                      <ChevronDown className="size-3" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="start">
                                    <DropdownMenuItem
                                      disabled={user.status === "ACTIVE"}
                                      onClick={() =>
                                        statusMutation.mutate({ id: user.id, status: "ACTIVE" })
                                      }
                                    >
                                      Activate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={user.status === "DISABLED"}
                                      className="text-danger focus:text-danger"
                                      onClick={() =>
                                        statusMutation.mutate({ id: user.id, status: "DISABLED" })
                                      }
                                    >
                                      Disable
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : (
                                <span
                                  className={cn(
                                    "inline-flex items-center text-xs font-medium",
                                    STATUS_STYLES[user.status] ?? "bg-muted"
                                  )}
                                >
                                  {user.status}
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="inline-flex cursor-default items-center text-xs font-medium tabular-nums text-brand">
                                    {fullAccess
                                      ? "All modules"
                                      : `${modules.length} ${
                                          modules.length === 1 ? "module" : "modules"
                                        }`}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-64">
                                  {fullAccess
                                    ? "Full access to every module."
                                    : modules.length > 0
                                      ? modules.map(moduleLabel).join(", ")
                                      : "No module access."}
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <ChipList items={user.territory} tone="muted" />
                                <ChipList items={user.skills} tone="outline" />
                                {user.territory.length === 0 && user.skills.length === 0 ? (
                                  <span className="text-xs text-muted-foreground">None</span>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {user.phone ? (
                                <span className="flex items-center gap-1.5 font-mono text-xs">
                                  {user.phone}
                                  {user.available_for_calls === false ? (
                                    <span
                                      className="size-1.5 rounded-full bg-muted-foreground/50"
                                      title="Not taking inbound calls"
                                      aria-label="Not taking inbound calls"
                                    />
                                  ) : (
                                    <span
                                      className="size-1.5 rounded-full bg-success"
                                      title="Available for inbound calls"
                                      aria-label="Available for inbound calls"
                                    />
                                  )}
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">Not linked</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                              {timeAgo(user.last_login_at)}
                            </TableCell>
                            {canManageTeam ? (
                              <TableCell className="text-right">
                                {canManageUser(user) ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <Button variant="ghost" size="icon" className="size-8">
                                        <MoreHorizontal className="size-4" />
                                        <span className="sr-only">Member actions</span>
                                      </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                      <DropdownMenuItem onClick={() => openEdit(user)}>
                                        <Pencil className="size-3.5" />
                                        Edit member
                                      </DropdownMenuItem>
                                      {user.id !== me?.id ? (
                                        <DropdownMenuItem onClick={() => setResetTarget(user)}>
                                          <KeyRound className="size-3.5" />
                                          Reset password
                                        </DropdownMenuItem>
                                      ) : null}
                                      {user.id !== me?.id ? (
                                        <DropdownMenuItem
                                          className="text-danger focus:text-danger"
                                          onClick={() => setDeleteUserTarget(user)}
                                        >
                                          <Trash2 className="size-3.5" />
                                          Remove from workspace
                                        </DropdownMenuItem>
                                      ) : null}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : null}
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Roles & permissions */}
        <section className="reveal" style={{ animationDelay: "140ms" }}>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Roles &amp; permissions</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  What each role can access. Built-in roles are fixed; custom roles can be edited
                  or deleted and grant a precise set of modules and admin capabilities.
                </p>
              </div>
              {canManageTeam ? (
                <Button variant="ghost" size="sm" onClick={() => setRoleOpen(true)}>
                  <ShieldPlus />
                  New Role
                </Button>
              ) : null}
            </CardHeader>
            <CardContent>
              {rolesLoading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 rounded-lg" />
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {roleViews.map((role) => {
                    const meta = ROLE_META[role.key];
                    const Icon = meta?.icon ?? Shield;
                    const count = countByRole[role.key] ?? 0;
                    return (
                      <div
                        key={`${role.kind}-${role.key}`}
                        className="flex flex-col rounded-lg border p-4 transition-colors duration-120 hover:border-brand/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <span className="flex size-9 shrink-0 items-center justify-center text-brand">
                              <Icon className="size-4" />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-display text-sm font-semibold tracking-tight">
                                {role.name}
                              </p>
                              <p className="text-xs tabular-nums text-muted-foreground">
                                {count} {count === 1 ? "member" : "members"}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <Badge variant={role.kind === "Built-in" ? "neutral" : "brand"}>
                              {role.kind}
                            </Badge>
                            {role.kind === "Built-in" && isCustomized(role.key) ? (
                              <span className="text-[10px] font-medium text-warning">
                                Customized
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {meta?.blurb ? (
                          <p className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
                            {meta.blurb}
                          </p>
                        ) : null}
                        <div className="mt-3 border-t pt-3">
                          <ModuleChips modules={role.modules} />
                        </div>
                        {canManageRole(role.key) ? (
                          <div className="mt-3 flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => openEditRole(role)}>
                              <Pencil />
                              Edit
                            </Button>
                            {role.kind === "Custom" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-danger hover:text-danger"
                                onClick={() =>
                                  setDeleteRoleTarget({
                                    key: role.key,
                                    name: role.name,
                                    builtin: false,
                                  })
                                }
                              >
                                <Trash2 />
                                Delete
                              </Button>
                            ) : isCustomized(role.key) ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setDeleteRoleTarget({
                                    key: role.key,
                                    name: role.name,
                                    builtin: true,
                                  })
                                }
                              >
                                <RotateCcw />
                                Reset
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Invite user dialog */}
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite User</DialogTitle>
              <DialogDescription>
                Add a teammate to this workspace and choose their role.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitInvite} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="invite-name">Name</Label>
                <Input
                  id="invite-name"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Priya Sharma"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-email">Email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="priya@company.example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="users-role-2">Role</Label>
                <Select value={inviteRole} onValueChange={setInviteRole}>
                  <SelectTrigger id="users-role-2">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Built-in</SelectLabel>
                      {assignableBuiltins.map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {(catalogue?.custom.length ?? 0) > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Custom</SelectLabel>
                        {catalogue?.custom.map((role) => (
                          <SelectItem key={role.key} value={role.key}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
                {selectedRoleModules.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Grants:{" "}
                    {selectedRoleModules.includes("*")
                      ? "every module"
                      : selectedRoleModules.map(moduleLabel).join(", ")}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="invite-password">Password (optional)</Label>
                <Input
                  id="invite-password"
                  type="password"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                  placeholder="Leave blank to auto-generate"
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to generate a secure password and email the sign-in details to the
                  member.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Territory</Label>
                <TagInput
                  value={inviteTerritory}
                  onChange={setInviteTerritory}
                  placeholder="e.g. Mumbai, Delhi, press Enter to add"
                />
                <p className="text-xs text-muted-foreground">
                  Cities this agent covers. Used by territory-based lead assignment.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Skills</Label>
                <TagInput
                  value={inviteSkills}
                  onChange={setInviteSkills}
                  listId="lead-sources-suggestions"
                  placeholder="e.g. WhatsApp, LinkedIn Forms, press Enter to add"
                />
                <p className="text-xs text-muted-foreground">
                  Lead sources this agent specialises in. Used by skill-based assignment.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={inviteMutation.isPending}>
                  Send invite
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit member (territory & skills) dialog */}
        <Dialog open={editUser !== null} onOpenChange={(open) => !open && setEditUser(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit {editUser?.name}</DialogTitle>
              <DialogDescription>
                Change this member&apos;s role, and the territory and skills that drive
                territory- and skill-based lead assignment.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitEdit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="users-role">Role</Label>
                <Select
                  value={editUserRole}
                  onValueChange={setEditUserRole}
                  disabled={editUser?.id === me?.id}
                >
                  <SelectTrigger id="users-role">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel>Built-in</SelectLabel>
                      {assignableBuiltins.map((role) => (
                        <SelectItem key={role} value={role}>
                          {roleLabel(role)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    {(catalogue?.custom.length ?? 0) > 0 ? (
                      <SelectGroup>
                        <SelectLabel>Custom</SelectLabel>
                        {catalogue?.custom.map((role) => (
                          <SelectItem key={role.key} value={role.key}>
                            {role.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ) : null}
                  </SelectContent>
                </Select>
                {editUser?.id === me?.id ? (
                  <p className="text-xs text-muted-foreground">
                    You can&apos;t change your own role.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-phone">Calling number</Label>
                <Input
                  id="edit-phone"
                  value={editPhone}
                  placeholder="+919876543210"
                  onChange={(e) => setEditPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Inbound calls route to this phone. Leave empty to clear it.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Territory</Label>
                <TagInput
                  value={editTerritory}
                  onChange={setEditTerritory}
                  placeholder="e.g. Mumbai, Delhi, press Enter to add"
                />
                <p className="text-xs text-muted-foreground">
                  Cities this agent covers, matched against a lead&apos;s city.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Skills</Label>
                <TagInput
                  value={editSkills}
                  onChange={setEditSkills}
                  listId="lead-sources-suggestions"
                  placeholder="e.g. WhatsApp, LinkedIn Forms, press Enter to add"
                />
                <p className="text-xs text-muted-foreground">
                  Lead sources this agent specialises in, matched against a lead&apos;s source.
                </p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={editMutation.isPending}>
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Reset password confirmation */}
        <Dialog open={resetTarget !== null} onOpenChange={(open) => !open && setResetTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-warning/12 text-warning">
                <KeyRound className="size-5" />
              </div>
              <DialogTitle>Reset password?</DialogTitle>
              <DialogDescription>
                A new random password will be generated for{" "}
                <span className="font-medium text-foreground">{resetTarget?.name}</span> and emailed
                to{" "}
                <span className="font-medium text-foreground">{resetTarget?.email}</span>. Their
                current password will stop working immediately.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetTarget(null)}
                disabled={resetMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                loading={resetMutation.isPending}
                onClick={() => resetTarget && resetMutation.mutate(resetTarget.id)}
              >
                Reset &amp; email password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lead-source suggestions shared by the skills tag inputs. */}
        <datalist id="lead-sources-suggestions">
          {leadSources.map((source) => (
            <option key={source} value={source} />
          ))}
        </datalist>

        {/* New role dialog */}
        <Dialog open={roleOpen} onOpenChange={setRoleOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Role</DialogTitle>
              <DialogDescription>Name the role and pick the modules it can access.</DialogDescription>
            </DialogHeader>
            <form onSubmit={submitRole} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="role-name">Role name</Label>
                <Input
                  id="role-name"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  placeholder="Field Sales"
                  autoFocus
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Modules</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {roleModules.length} selected
                  </span>
                </div>
                <RolePermissionPicker
                  catalogue={catalogue?.catalogue ?? []}
                  selected={roleModules}
                  onToggle={toggleRoleModule}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setRoleOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={roleMutation.isPending}>
                  Create role
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit role dialog */}
        <Dialog open={editRole !== null} onOpenChange={(open) => !open && setEditRole(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit {editRole?.name}</DialogTitle>
              <DialogDescription>
                {editRole?.builtin
                  ? "Change what this built-in role can access. Its name is fixed, and you can reset it to the default later. Members pick up the change on their next sign-in."
                  : "Rename the role or change what it can access. Members with this role pick up the change on their next sign-in."}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={submitEditRole} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-role-name">Role name</Label>
                <Input
                  id="edit-role-name"
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  disabled={editRole?.builtin}
                  autoFocus={!editRole?.builtin}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Modules</Label>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {editRoleModules.length} selected
                  </span>
                </div>
                <RolePermissionPicker
                  catalogue={catalogue?.catalogue ?? []}
                  selected={editRoleModules}
                  onToggle={toggleEditRoleModule}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditRole(null)}>
                  Cancel
                </Button>
                <Button type="submit" loading={updateRoleMutation.isPending}>
                  Save changes
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete role confirmation */}
        <Dialog
          open={deleteRoleTarget !== null}
          onOpenChange={(open) => !open && setDeleteRoleTarget(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div
                className={cn(
                  "mb-1 flex size-10 items-center justify-center rounded-full",
                  deleteRoleTarget?.builtin
                    ? "bg-warning/12 text-warning"
                    : "bg-danger/12 text-danger"
                )}
              >
                {deleteRoleTarget?.builtin ? (
                  <RotateCcw className="size-5" />
                ) : (
                  <Trash2 className="size-5" />
                )}
              </div>
              <DialogTitle>
                {deleteRoleTarget?.builtin ? "Reset role to default?" : "Delete role?"}
              </DialogTitle>
              <DialogDescription>
                {deleteRoleTarget?.builtin ? (
                  <>
                    This discards your changes and restores the default access for the{" "}
                    <span className="font-medium text-foreground">{deleteRoleTarget?.name}</span>{" "}
                    role. Members with it pick up the defaults on their next sign-in.
                  </>
                ) : (
                  <>
                    This permanently deletes the{" "}
                    <span className="font-medium text-foreground">{deleteRoleTarget?.name}</span>{" "}
                    role. If any member still has it, you&apos;ll need to reassign them first.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteRoleTarget(null)}
                disabled={deleteRoleMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant={deleteRoleTarget?.builtin ? "default" : "destructive"}
                loading={deleteRoleMutation.isPending}
                onClick={() => deleteRoleTarget && deleteRoleMutation.mutate(deleteRoleTarget.key)}
              >
                {deleteRoleTarget?.builtin ? "Reset to default" : "Delete role"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Remove user confirmation */}
        <Dialog
          open={deleteUserTarget !== null}
          onOpenChange={(open) => !open && setDeleteUserTarget(null)}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-danger/12 text-danger">
                <Trash2 className="size-5" />
              </div>
              <DialogTitle>Remove {deleteUserTarget?.name}?</DialogTitle>
              <DialogDescription>
                Their leads, deals, tasks, tickets and other owned records will be reassigned
                round-robin to the remaining active team members, then their account is
                permanently deleted. This can&apos;t be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteUserTarget(null)}
                disabled={deleteUserMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={deleteUserMutation.isPending}
                onClick={() =>
                  deleteUserTarget && deleteUserMutation.mutate(deleteUserTarget.id)
                }
              >
                Remove &amp; reassign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Post-deletion reassignment report */}
        <Dialog open={deleteReport !== null} onOpenChange={(open) => !open && setDeleteReport(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{deleteReport?.deleted.name} removed</DialogTitle>
              <DialogDescription>
                {deleteReport && deleteReport.totalReassigned > 0
                  ? `Reassigned ${deleteReport.totalReassigned} record${
                      deleteReport.totalReassigned === 1 ? "" : "s"
                    } across ${deleteReport.reassignedAmong.length} teammate${
                      deleteReport.reassignedAmong.length === 1 ? "" : "s"
                    }.`
                  : "This member had no owned records to reassign."}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {deleteReport
                ? Object.entries(deleteReport.reassigned)
                    .filter(([, r]) => r.total > 0)
                    .map(([entity, r]) => (
                      <div key={entity} className="border-t pt-2.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{ENTITY_LABELS[entity] ?? entity}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {r.total}
                            {r.unassigned > 0 ? ` · ${r.unassigned} unassigned` : ""}
                          </span>
                        </div>
                        {r.distribution.length > 0 ? (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {r.distribution.map((d) => `${d.name} (${d.count})`).join(", ")}
                          </p>
                        ) : null}
                      </div>
                    ))
                : null}
              {deleteReport &&
              (deleteReport.cleaned.notifications ||
                deleteReport.cleaned.reminders ||
                deleteReport.cleaned.savedViews) ? (
                <p className="pt-1 text-xs text-muted-foreground">
                  Cleared {deleteReport.cleaned.notifications} notification(s),{" "}
                  {deleteReport.cleaned.reminders} reminder(s) and {deleteReport.cleaned.savedViews}{" "}
                  saved view(s).
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => setDeleteReport(null)}>
                Done
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
