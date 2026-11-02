import { createBrowserRouter, type RouteObject } from "react-router-dom";

import AppShell from "@/components/layout/AppShell";
import RouteError from "@/components/layout/RouteError";
import LoginPage from "@/pages/login";

type PageModule = { default: React.ComponentType };

/**
 * Each page is its own chunk, loaded when its route is first visited, so the
 * sign-in screen does not download the whole console.
 */
const page = (load: () => Promise<PageModule>): Pick<RouteObject, "lazy"> => ({
  lazy: () => load().then((m) => ({ Component: m.default })),
});

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    // Pages load lazily; render nothing while the first one arrives.
    hydrateFallbackElement: null,
    children: [
      { path: "/login", element: <LoginPage /> },
      // Public: the operator password-reset link lands here to set a new password.
      { path: "/reset-password", ...page(() => import("@/pages/reset-password")) },
      {
        element: <AppShell />,
        children: [
          { path: "/", ...page(() => import("@/pages/dashboard")) },
          { path: "/tenants", ...page(() => import("@/pages/tenants")) },
          { path: "/tenants/:id", ...page(() => import("@/pages/tenant-detail")) },
          { path: "/plans", ...page(() => import("@/pages/plans")) },
          { path: "/billing", ...page(() => import("@/pages/billing")) },
          { path: "/operators", ...page(() => import("@/pages/operators")) },
          { path: "/audit", ...page(() => import("@/pages/audit")) },
          { path: "/profile", ...page(() => import("@/pages/profile")) },
          { path: "*", ...page(() => import("@/pages/not-found")) },
        ],
      },
    ],
  },
]);
