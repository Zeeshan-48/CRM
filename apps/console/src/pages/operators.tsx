import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Pencil, Plus, UserCog } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createOperator, listOperators, updateOperator } from "@/lib/api/operators";
import { timeAgo } from "@/lib/format";
import { isSuperadmin, useAuthStore } from "@/stores/auth-store";
import type { OperatorRole, OperatorStatus, OperatorUser } from "@/types";

interface CreateFormState {
  name: string;
  email: string;
  role: OperatorRole;
  password: string;
}

const EMPTY_CREATE_FORM: CreateFormState = {
  name: "",
  email: "",
  role: "OPERATOR",
  password: "",
};

interface EditFormState {
  name: string;
  role: OperatorRole;
  status: OperatorStatus;
}

export default function OperatorsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canWrite = isSuperadmin(user);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [createForm, setCreateForm] = React.useState<CreateFormState>(EMPTY_CREATE_FORM);
  // Shown once, only when the backend generated a password it could not email.
  const [issuedPassword, setIssuedPassword] = React.useState<{
    email: string;
    password: string;
  } | null>(null);
  const [editing, setEditing] = React.useState<OperatorUser | null>(null);
  const [editForm, setEditForm] = React.useState<EditFormState>({
    name: "",
    role: "OPERATOR",
    status: "ACTIVE",
  });

  const operatorsQuery = useQuery({
    queryKey: ["operators"],
    queryFn: listOperators,
  });

  const createMutation = useMutation({
    mutationFn: createOperator,
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["operators"] });
      toast.success(
        created.emailed
          ? `Operator ${created.email} created, invite emailed`
          : `Operator ${created.email} created`
      );
      // No email transport: this is the only time the generated password is
      // readable, so surface it instead of silently losing it.
      if (created.tempPassword) {
        setIssuedPassword({ email: created.email, password: created.tempPassword });
      }
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Creating the operator failed.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<EditFormState> }) =>
      updateOperator(id, payload),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["operators"] });
      toast.success(`Operator ${updated.email} updated`);
      setEditing(null);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Updating the operator failed.");
    },
  });

  const operators = operatorsQuery.data ?? [];

  const handleCreate = () => {
    if (!createForm.name.trim() || !createForm.email.trim()) {
      toast.error("Name and email are required.");
      return;
    }
    createMutation.mutate({
      name: createForm.name.trim(),
      email: createForm.email.trim().toLowerCase(),
      role: createForm.role,
      ...(createForm.password ? { password: createForm.password } : {}),
    });
  };

  const openEdit = (operator: OperatorUser) => {
    setEditing(operator);
    setEditForm({
      name: operator.name,
      role: operator.role,
      status: operator.status === "PENDING" ? "ACTIVE" : operator.status,
    });
  };

  const handleEdit = () => {
    if (!editing) return;
    if (!editForm.name.trim()) {
      toast.error("Name cannot be empty.");
      return;
    }
    updateMutation.mutate({
      id: editing.id,
      payload: { name: editForm.name.trim(), role: editForm.role, status: editForm.status },
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Operators"
        description="Platform operators with access to this console. Superadmins can manage tenants, plans and operators; operators have read-only access."
        actions={
          canWrite ? (
            <Button onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="size-4" />
              New Operator
            </Button>
          ) : null
        }
      />

      {!canWrite ? (
        <div
          className="reveal flex items-center gap-2.5 border-l-2 border-warning py-1 pl-3 text-sm text-warning"
          style={{ animationDelay: "60ms" }}
        >
          <Lock className="size-4 shrink-0" />
          You have read-only access. Ask a superadmin to create or edit operators.
        </div>
      ) : null}

      <div className="reveal rounded-lg border bg-card" style={{ animationDelay: "120ms" }}>
        {operatorsQuery.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : operators.length === 0 ? (
          <EmptyState
            icon={UserCog}
            title="No operators"
            description="No operator accounts were found."
            className="border-0"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
                {canWrite ? <TableHead className="text-right">Action</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {operators.map((operator) => (
                <TableRow key={operator.id}>
                  <TableCell className="font-medium">{operator.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {operator.email}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={operator.role === "SUPERADMIN" ? "brand" : "secondary"}
                      className="text-[11px]"
                    >
                      {operator.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={operator.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {timeAgo(operator.last_login_at)}
                  </TableCell>
                  {canWrite ? (
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => openEdit(operator)}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setCreateForm(EMPTY_CREATE_FORM);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New operator</DialogTitle>
            <DialogDescription>
              Console access for a platform operator.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="op-name">Name</Label>
              <Input
                id="op-name"
                placeholder="Asha Nair"
                value={createForm.name}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-email">Email</Label>
              <Input
                id="op-email"
                type="email"
                placeholder="asha@acme.example.com"
                value={createForm.email}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, email: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-operator-role">Role</Label>
              <Select
                value={createForm.role}
                onValueChange={(value) =>
                  setCreateForm((prev) => ({ ...prev, role: value as OperatorRole }))
                }
              >
                <SelectTrigger id="create-operator-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">OPERATOR (read-only)</SelectItem>
                  <SelectItem value="SUPERADMIN">SUPERADMIN (full access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="op-password">Password</Label>
              <Input
                id="op-password"
                type="text"
                placeholder="Leave blank to generate one"
                value={createForm.password}
                onChange={(event) =>
                  setCreateForm((prev) => ({ ...prev, password: event.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground">
                Leave blank and a secure password is generated and emailed to the operator.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} className="gap-1.5">
              {createMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create operator
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated-password handoff. Only rendered when email delivery is off,
          so the superadmin can pass the credential along out of band. */}
      <Dialog open={!!issuedPassword} onOpenChange={(open) => !open && setIssuedPassword(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save this password</DialogTitle>
            <DialogDescription>
              Email delivery isn&apos;t configured, so the invite couldn&apos;t be sent. This is the
              only time this password is shown, share it with the operator securely.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 border-t pt-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Email
              </p>
              <p className="font-mono text-sm">{issuedPassword?.email}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Temporary password
              </p>
              <p className="font-mono text-sm">{issuedPassword?.password}</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (issuedPassword) {
                  void navigator.clipboard.writeText(issuedPassword.password);
                  toast.success("Password copied");
                }
              }}
            >
              Copy password
            </Button>
            <Button onClick={() => setIssuedPassword(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit operator</DialogTitle>
            <DialogDescription>{editing?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="op-edit-name">Name</Label>
              <Input
                id="op-edit-name"
                value={editForm.name}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-operator-role">Role</Label>
              <Select
                value={editForm.role}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, role: value as OperatorRole }))
                }
              >
                <SelectTrigger id="edit-operator-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR">OPERATOR (read-only)</SelectItem>
                  <SelectItem value="SUPERADMIN">SUPERADMIN (full access)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-operator-status">Status</Label>
              <Select
                value={editForm.status}
                onValueChange={(value) =>
                  setEditForm((prev) => ({ ...prev, status: value as OperatorStatus }))
                }
              >
                <SelectTrigger id="edit-operator-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="DISABLED">DISABLED</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={updateMutation.isPending} className="gap-1.5">
              {updateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
