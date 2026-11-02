import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";

import { useAuthStore } from "@/stores/auth-store";
import AppShell from "@/components/layout/AppShell";
import RequireModule from "@/components/auth/RequireModule";
import RouteError from "@/components/layout/RouteError";
import LoginPage from "@/pages/login";

type PageModule = { default: React.ComponentType };

/**
 * Each page is its own chunk, loaded when its route is first visited, so the
 * sign-in screen does not download the whole workspace.
 */
const page = (load: () => Promise<PageModule>): Pick<RouteObject, "lazy"> => ({
  lazy: () => load().then((m) => ({ Component: m.default })),
});

/** "/" sends a signed-in user to the workspace and everyone else to sign-in. */
function RootRoute() {
  const token = useAuthStore((s) => s.token);
  return <Navigate to={token ? "/dashboard" : "/login"} replace />;
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    // Pages load lazily; render nothing while the first one arrives.
    hydrateFallbackElement: null,
    children: [
      { path: "/", element: <RootRoute /> },
      { path: "/login", element: <LoginPage /> },
      // Public self-service password reset. Requesting the link happens on the
      // sign-in screen; the link lands here.
      { path: "/reset-password", ...page(() => import("@/pages/reset-password")) },
      // Public self-service booking page (no auth, no app shell).
      { path: "/meet/:tenantSlug/:linkSlug", ...page(() => import("@/pages/public-booking")) },
      {
        element: <AppShell />,
        children: [
          { path: "/dashboard", ...page(() => import("@/pages/dashboard")) },
          { path: "/leads", ...page(() => import("@/pages/leads")) },
          { path: "/leads/:id", ...page(() => import("@/pages/lead-detail")) },
          { path: "/contacts", ...page(() => import("@/pages/contacts")) },
          { path: "/contacts/:id", ...page(() => import("@/pages/contact-detail")) },
          { path: "/accounts", ...page(() => import("@/pages/accounts")) },
          { path: "/pipeline", ...page(() => import("@/pages/pipeline")) },
          { path: "/activities", ...page(() => import("@/pages/activities")) },
          { path: "/calendar", ...page(() => import("@/pages/calendar")) },
          { path: "/inbox", ...page(() => import("@/pages/inbox")) },
          { path: "/inbox/:channel", ...page(() => import("@/pages/inbox")) },
          { path: "/email", ...page(() => import("@/pages/email")) },
          { path: "/campaigns", ...page(() => import("@/pages/campaigns")) },
          { path: "/tickets", ...page(() => import("@/pages/tickets")) },
          { path: "/kb", ...page(() => import("@/pages/kb")) },
          { path: "/workflows", ...page(() => import("@/pages/workflows")) },
          { path: "/agents", ...page(() => import("@/pages/agents")) },
          { path: "/sales-agent", ...page(() => import("@/pages/sales-agent")) },
          { path: "/analytics", ...page(() => import("@/pages/analytics")) },
          { path: "/finance", ...page(() => import("@/pages/finance")) },
          { path: "/reminders", ...page(() => import("@/pages/reminders")) },
          { path: "/profile", ...page(() => import("@/pages/profile")) },
          // Channels and Administration are gated at the route by the module or
          // governance capability the user's role grants, so typing the URL does
          // not load them (nav.ts only hides the links). The API enforces the
          // same keys per endpoint.
          {
            element: <RequireModule module="channels" />,
            children: [
              { path: "/whatsapp", ...page(() => import("@/pages/whatsapp")) },
              { path: "/email-sending", ...page(() => import("@/pages/email-sending")) },
              { path: "/telephony", ...page(() => import("@/pages/telephony")) },
            ],
          },
          {
            element: <RequireModule module="integrations" />,
            children: [{ path: "/integrations", ...page(() => import("@/pages/integrations")) }],
          },
          {
            element: <RequireModule module="products" />,
            children: [
              { path: "/products", ...page(() => import("@/pages/products")) },
              { path: "/signals", ...page(() => import("@/pages/signals")) },
            ],
          },
          {
            element: <RequireModule module="audit" />,
            children: [{ path: "/audit", ...page(() => import("@/pages/audit")) }],
          },
          {
            element: <RequireModule module="team" />,
            children: [{ path: "/users", ...page(() => import("@/pages/users")) }],
          },
          {
            element: <RequireModule module="settings" />,
            children: [{ path: "/settings", ...page(() => import("@/pages/settings")) }],
          },
          {
            element: <RequireModule module="billing" />,
            children: [{ path: "/billing", ...page(() => import("@/pages/billing")) }],
          },
          { path: "*", ...page(() => import("@/pages/not-found")) },
        ],
      },
    ],
  },
]);
