import { Navigate, Outlet } from "react-router-dom";

import { hasModule } from "@/stores/auth-store";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Route-level access gate, driven entirely by the module/capability the user's
 * role grants (never by hardcoded role names). Wraps a group of routes and
 * bounces anyone who lacks `module` to the dashboard, so a page can't be loaded
 * by typing its URL, nav.ts only *hides* links, which is cosmetic on its own.
 *
 * This mirrors the backend, which enforces the same module/capability per
 * endpoint. Governance capabilities (channels, team, billing, settings) and
 * feature modules are both just keys in the user's resolved `modules`.
 */
export default function RequireModule({ module }: { module: string }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (!hasModule(user, module)) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
