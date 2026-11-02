import { ArrowLeft, CheckCircle2, Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/lib/brand";
import { resetPassword } from "@/lib/api/auth";

function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={
        "flex items-center justify-center rounded-md bg-brand font-display font-bold text-brand-foreground " +
        className
      }
      aria-hidden
    >
      {BRAND.initial}
    </span>
  );
}

const MIN_LENGTH = 8;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < MIN_LENGTH) {
      toast.error(`Password must be at least ${MIN_LENGTH} characters.`, {
        id: "reset",
      });
      return;
    }
    if (password !== confirm) {
      toast.error("The two passwords don't match.", { id: "reset" });
      return;
    }
    setSubmitting(true);
    try {
      await resetPassword({ token, password });
      setDone(true);
      toast.success("Password updated. You can now sign in.", { id: "reset" });
      // Give the success screen a beat, then send them to sign in.
      setTimeout(() => navigate("/login", { replace: true }), 1800);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not reset your password.",
        { id: "reset" },
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="reveal w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <BrandMark className="size-9 text-sm" />
          <span className="font-display text-xl font-bold tracking-tight">
            {BRAND.name}
          </span>
        </div>

        <div className="rounded-2xl border bg-card p-7 sm:p-8">
          {!token ? (
            <div className="text-center">
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Invalid reset link
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                This link is missing its reset token. Head back to sign in and
                tap “Forgot password?” to get a fresh link.
              </p>
              <Button
                asChild
                size="lg"
                className="mt-6 w-full bg-brand text-brand-foreground hover:bg-brand/90"
              >
                <Link to="/login">Back to sign in</Link>
              </Button>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 className="size-6" />
              </div>
              <h2 className="mt-4 font-display text-2xl font-semibold tracking-tight">
                Password updated
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Your password has been changed. Redirecting you to sign in…
              </p>
              <Button
                asChild
                size="lg"
                className="mt-6 w-full bg-brand text-brand-foreground hover:bg-brand/90"
              >
                <Link to="/login">Go to sign in</Link>
              </Button>
            </div>
          ) : (
            <>
              <h2 className="font-display text-2xl font-semibold tracking-tight">
                Set a new password
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Choose a strong password you don&apos;t use anywhere else.
              </p>

              <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                <div className="space-y-1.5">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder={`At least ${MIN_LENGTH} characters`}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      disabled={submitting}
                      className="pr-10"
                      autoFocus
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      disabled={submitting}
                      tabIndex={-1}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm">Confirm new password</Label>
                  <Input
                    id="confirm"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Re-enter your new password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                    disabled={submitting}
                  />
                  {confirm.length > 0 && confirm !== password ? (
                    <p className="text-xs text-danger">
                      Passwords don&apos;t match yet.
                    </p>
                  ) : null}
                </div>

                <Button
                  type="submit"
                  size="lg"
                  className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
                  loading={submitting}
                  disabled={submitting}
                >
                  {submitting ? "Saving…" : "Save new password"}
                </Button>
              </form>
            </>
          )}

          <div className="mt-6 text-center">
            <Link
              to="/login"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Back to sign in
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          {BRAND.poweredBy}
        </p>
      </div>
    </div>
  );
}
