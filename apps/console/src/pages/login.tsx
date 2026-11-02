import { Building2, Layers, Loader2, ScrollText } from "lucide-react";
import * as React from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, requestPasswordReset } from "@/lib/api/auth";
import { BRAND } from "@/lib/brand";
import { useAuthStore } from "@/stores/auth-store";

const FEATURES = [
  {
    icon: Building2,
    title: "Onboard tenants in minutes",
    text: "Provision a workspace, snapshot plan entitlements and hand over admin credentials in one guided flow.",
  },
  {
    icon: Layers,
    title: "Plans and entitlements",
    text: "Define plan catalogs, then override per-tenant module gates and limits without touching the plan.",
  },
  {
    icon: ScrollText,
    title: "Full operator audit trail",
    text: "Every onboarding, suspension and override is recorded with actor, tenant and metadata.",
  },
];

export default function LoginPage() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [forgotSubmitting, setForgotSubmitting] = React.useState(false);

  if (token) return <Navigate to="/" replace />;

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
        `If an operator account exists for ${trimmed}, a reset link is on its way.`,
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
      navigate("/", { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign in failed.", {
        id: "auth",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden border-r p-10 lg:flex xl:p-14">
        <div className="absolute inset-0 bg-[hsl(0_0%_3%)]" />
        <div className="absolute inset-0 dot-grid" />

        <div className="relative flex items-baseline gap-2">
          <span className="font-display text-xl font-bold tracking-tight text-white">
            {BRAND.name}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
            Operator
          </span>
        </div>

        <div className="relative max-w-xl space-y-10 text-white">
          <h1 className="font-display text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
            The control room for every {BRAND.name} workspace
          </h1>
          <ul className="space-y-6">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-4">
                <feature.icon className="mt-0.5 h-[18px] w-[18px] shrink-0 text-white/70" aria-hidden />
                <div>
                  <p className="font-display text-sm font-semibold tracking-tight">
                    {feature.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-white/70">
                    {feature.text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-4 text-xs text-white/60">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-success" /> Active
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-warning" /> Suspended
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-destructive" /> Closed
            </span>
          </div>
        </div>

        <p className="relative text-xs text-white/50">
          &copy; {new Date().getFullYear()} {BRAND.name} contributors.
        </p>
      </div>

      {/* Sign-in form */}
      <div className="flex flex-1 flex-col items-center justify-center bg-background px-6 py-12">
        <div className="reveal w-full max-w-md">
          <div className="mb-8 flex items-baseline gap-2 lg:hidden">
            <span className="font-display text-xl font-bold tracking-tight text-brand">
              {BRAND.name}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Operator
            </span>
          </div>

          <div className="rounded-lg border bg-card p-7 sm:p-8">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              Operator sign in
            </h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Restricted to platform operators.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@acme.example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <button
                    type="button"
                    onClick={handleForgot}
                    disabled={submitting || forgotSubmitting}
                    className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
                  >
                    {forgotSubmitting ? "Sending…" : "Forgot password?"}
                  </button>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  disabled={submitting}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : null}
                {submitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {BRAND.poweredBy}
          </p>
        </div>
      </div>
    </div>
  );
}
