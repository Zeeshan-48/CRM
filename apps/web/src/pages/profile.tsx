import { useMutation } from "@tanstack/react-query";
import { KeyRound, Phone, ShieldCheck, User as UserIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changeMyPassword, updateMyPhone } from "@/lib/api/users";
import { initials } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";

// SALES_AGENT -> "Sales Agent"
const prettyRole = (role: string): string =>
  role
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ") || role;

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);

  const [phone, setPhone] = React.useState(user?.phone ?? "");
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  React.useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  const phoneMutation = useMutation({
    mutationFn: () => updateMyPhone(phone.trim()),
    onSuccess: (data) => {
      patchUser({ phone: data.phone });
      toast.success("Callback number updated.");
    },
    onError: (error) => toast.error(error.message),
  });

  const passwordMutation = useMutation({
    mutationFn: () => changeMyPassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) => toast.error(error.message),
  });

  const submitPassword = (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentPassword || !newPassword) {
      toast.error("Enter your current and new password.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match.");
      return;
    }
    if (currentPassword === newPassword) {
      toast.error("New password must differ from the current password.");
      return;
    }
    passwordMutation.mutate();
  };

  if (!user) return null;

  const modules = Array.isArray(user.modules) ? user.modules : [];
  const allModules = modules.includes("*");

  return (
    <div className="space-y-6">
      <PageHeader title="My profile" description="Your account details and security." />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Account details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="size-4 text-brand" />
              Account
            </CardTitle>
            <CardDescription>Managed by your workspace administrator.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex items-center gap-3">
              <Avatar className="size-12">
                <AvatarFallback className="text-base">{initials(user.name)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <DetailRow label="Name" value={user.name} />
            <DetailRow label="Email" value={user.email} />
            <DetailRow label="Role" value={<Badge variant="secondary">{prettyRole(user.role)}</Badge>} />
            <DetailRow label="Workspace" value={user.tenant?.name ?? "-"} />
            {user.tenant?.plan_key ? (
              <DetailRow label="Plan" value={prettyRole(user.tenant.plan_key)} />
            ) : null}
            <DetailRow
              label="Access"
              value={allModules ? "All modules" : `${modules.length} modules`}
            />
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Callback number */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="size-4 text-brand" />
                Callback number
              </CardTitle>
              <CardDescription>
                Used for click-to-call. Enter it in international format, e.g. +14155550123.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-end gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="profile-phone">Mobile number</Label>
                  <Input
                    id="profile-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+14155550123"
                  />
                </div>
                <Button
                  onClick={() => phoneMutation.mutate()}
                  loading={phoneMutation.isPending}
                  disabled={phone.trim() === (user.phone ?? "").trim()}
                >
                  Save
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Change password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4 text-brand" />
                Change password
              </CardTitle>
              <CardDescription>
                Enter your current password, then choose a new one (at least 8 characters).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={submitPassword}>
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <Button type="submit" loading={passwordMutation.isPending} className="gap-1.5">
                    <ShieldCheck className="size-4" />
                    Update password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
