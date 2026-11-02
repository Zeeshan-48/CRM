import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRAND } from "@/lib/brand";
import { login, requestPasswordReset } from "@/lib/api/auth";
import { useAuthStore } from "@/stores/auth-store";

// Shared field styling: the flat input, a touch taller on the sign-in page.
const FIELD_CLASS = "h-11 px-3.5 text-[15px] focus-visible:ring-offset-0";

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [forgotSubmitting, setForgotSubmitting] = React.useState(false);
  const [showPassword, setShowPassword] = React.useState(false);

  if (token) return <Navigate to="/dashboard" replace />;

  const params = new URLSearchParams(window.location.search);
  const justPaid =
    params.get("status") === "success" ||
    params.has("sim_sub") ||
    params.has("sim_pay");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      toast.error("Enter your email and password.", { id: "auth" });
      return;
    }
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim(), password });
      setAuth(result.token, result.user);
      toast.success(`Welcome back, ${result.user.name.split(" ")[0]}`, {
        id: "auth",
      });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed.", {
        id: "auth",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Forgot password reuses the email already typed above, no separate page.
  const handleForgot = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      toast.error("Enter your email above first, then tap Forgot password.", {
        id: "auth",
      });
      return;
    }
    setForgotSubmitting(true);
    try {
      await requestPasswordReset({ email: trimmed });
      toast.success(
        `If an account exists for ${trimmed}, a reset link is on its way.`,
        { id: "auth" },
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not send the reset link.",
        { id: "auth" },
      );
    } finally {
      setForgotSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Brand panel: the wordmark set as type, divided from the form by a hairline. */}
      <div className="hidden flex-1 flex-col items-center justify-center border-r px-12 text-center lg:flex">
        <div className="flex flex-col items-center">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
            The agentic Customer OS
          </span>
          <h1 className="mt-7 flex flex-col text-left font-display text-8xl font-semibold lowercase leading-[0.82] tracking-[-0.045em] text-foreground xl:text-[7.5rem]">
            <span>{BRAND.wordmark.lead}</span>
            <span className="ml-16 font-bold text-brand xl:ml-24">
              {BRAND.wordmark.accent}
            </span>
          </h1>
          <p className="mt-9 font-display text-2xl font-semibold tracking-tight xl:text-3xl">
            The all-in-one Customer OS
          </p>
          <p className="mt-3 max-w-sm text-lg leading-relaxed text-muted-foreground">
            Everything after the sale, on autopilot.
          </p>
          <div className="mt-8 flex items-center gap-2.5 text-sm font-medium text-muted-foreground">
            <span>AI agents</span>
            <span className="text-brand" aria-hidden>·</span>
            <span>Unified inbox</span>
            <span className="text-brand" aria-hidden>·</span>
            <span>Copilot</span>
          </div>
        </div>
      </div>

      {/* Sign-in form: sits directly on the canvas, no card. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="reveal w-full max-w-sm">
          <div className="mb-10 flex items-center justify-center gap-2.5 lg:hidden">
            <span className="font-display text-2xl font-bold tracking-tight">
              {BRAND.name}
            </span>
          </div>

          <h2 className="font-display text-3xl font-semibold tracking-tight">
            Sign in
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Welcome back. Sign in with your work email.
          </p>

          {justPaid ? (
            <div className="mt-6 flex items-start gap-2.5 border-t pt-3 text-sm text-success">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <p>
                Payment received, thank you. Sign in to access your workspace.
                It can take a moment to activate after payment.
              </p>
            </div>
          ) : null}

          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="email" className="pl-1 text-muted-foreground">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={submitting}
                className={FIELD_CLASS}
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between pl-1">
                <Label htmlFor="password" className="text-muted-foreground">
                  Password
                </Label>
                <button
                  type="button"
                  onClick={handleForgot}
                  disabled={submitting || forgotSubmitting}
                  className="text-xs font-medium text-brand transition-colors hover:underline disabled:opacity-50"
                >
                  {forgotSubmitting ? "Sending…" : "Forgot password?"}
                </button>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                  className={FIELD_CLASS + " pr-12"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center pr-4 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label={showPassword ? "Hide password" : "Show password"}
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
            <Button
              type="submit"
              className="h-11 w-full text-[15px] font-semibold"
              loading={submitting}
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-10 text-center text-xs text-muted-foreground">
            {BRAND.poweredBy}
          </p>
        </div>
      </div>
    </div>
  );
}
