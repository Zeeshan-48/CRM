import { useMutation, useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, UserRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { changePassword, getMe } from "@/lib/api/auth";
import { formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { useAuthStore } from "@/stores/auth-store";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/layout/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProfilePage() {
  const storeUser = useAuthStore((s) => s.user);

  const meQuery = useQuery({ queryKey: ["me"], queryFn: getMe });
  const user = meQuery.data?.user ?? storeUser;

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const passwordMutation = useMutation({
    mutationFn: () => changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      toast.success("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not update password"),
  });

  const submitPassword = () => {
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
    passwordMutation.mutate();
  };

  const detail = (label: string, value: ReactNode) => (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm font-medium">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Profile" description="Your operator account and security." />

      {/* Account details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserRound className="size-4 text-muted-foreground" />
            Account
          </CardTitle>
          <CardDescription>Your operator console identity.</CardDescription>
        </CardHeader>
        <CardContent>
          {meQuery.isLoading && !user ? (
            <Skeleton className="h-24" />
          ) : !user ? (
            <p className="text-sm text-muted-foreground">Could not load your account.</p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              {detail("Name", user.name)}
              {detail("Email", <span className="font-mono text-[13px]">{user.email}</span>)}
              {detail(
                "Role",
                <Badge variant="brand">
                  {user.role === "SUPERADMIN" ? "Superadmin" : "Operator"}
                </Badge>
              )}
              {detail("Status", <StatusBadge status={user.status} />)}
              {detail(
                "Last sign-in",
                user.last_login_at ? (
                  <span title={formatDateTime(user.last_login_at)}>{timeAgo(user.last_login_at)}</span>
                ) : (
                  "-"
                )
              )}
              {detail("Member since", user.created_at ? formatDate(user.created_at) : "-")}
            </dl>
          )}
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-muted-foreground" />
            Password
          </CardTitle>
          <CardDescription>Use at least 8 characters.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid max-w-md gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="current">Current password</Label>
              <Input
                id="current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new">New password</Label>
              <Input
                id="new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <div>
              <Button
                className="gap-1.5"
                disabled={passwordMutation.isPending}
                onClick={submitPassword}
              >
                {passwordMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Update password
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
