# Open CRM Frontend

Tenant-facing web app of Open CRM, the open-source, multi-tenant agentic CRM
("Customer OS"). A LinkedIn-style shell (top bar + left rail)
over 25+ pages covering sales, omnichannel conversations, marketing, service,
automation, AI agents, analytics and finance. The accent color re-themes
per tenant from the workspace's brand color at login.

Companion apps in this monorepo:

- [`apps/api`](../api): the API this app consumes (tenant plane under /api/v1, operator plane under /api/v1/operator, port 5066)
- [`apps/console`](../console): operator console

## Stack

- React 19 + Vite 6 + TypeScript strict
- react-router-dom 7 (createBrowserRouter), TanStack Query v5, Zustand
  (persisted auth), axios
- Tailwind CSS 3.4 with hand-vendored shadcn-style Radix components,
  lucide-react icons, sonner toasts, cmdk command palette
- Self-hosted fonts: Geist Variable (display and body) + Geist Mono

## Quick start

```bash
pnpm install
cp .env.example .env        # VITE_API_BASE_URL, defaults to http://localhost:5066/api/v1
pnpm dev                    # http://localhost:3570
```

Requires `apps/api` running and seeded. Demo logins:
`maya@northwind.example.com` / `admin123` (Northwind, all modules) or
`arjun@acme.example.com` / `admin123` (Acme). The sign-in page lists
tenants as clickable chips.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server on 3570 |
| `pnpm build` | production build |
| `pnpm preview` | serve the production build |
| `pnpm lint` / `pnpm type-check` | eslint / tsc |

## Structure

```
src/
  components/ui/         vendored shadcn-style primitives
  components/layout/     AppShell, TopBar, SideNav, nav registry (module gating)
  components/copilot/    Copilot drawer (Cmd/Ctrl+J)
  components/command/    command palette + global search (Cmd/Ctrl+K)
  lib/api/               one typed API module per domain (axios client unwraps the envelope)
  lib/brand.ts           default product name, wordmark and accent colour
  stores/auth-store.ts   persisted auth + per-tenant --brand CSS variable
  pages/                 one file per route
  routes.tsx             router registry (all 27 routes)
```

## Conventions

- Server state lives in TanStack Query only; Zustand holds client state.
- Navigation and quick actions are gated by `hasModule(user, key)`; the
  backend sends `user.modules` already intersected with the tenant's plan
  entitlements, and 403s anything not entitled.
- Accent styling uses the `brand`/`primary` Tailwind utilities only, so the
  whole UI re-tints per tenant; hover states use `hover:bg-muted`.
- 401 responses clear the session and redirect to `/login`.
