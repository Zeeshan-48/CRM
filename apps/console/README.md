# Open CRM Operator Frontend

Operator console for Open CRM, the open-source CRM SaaS: the control plane
where the fleet is managed. Dark "control room" theme. Operators onboard
tenants with a two-step wizard, manage plans, edit per-tenant entitlements,
suspend or reactivate workspaces, and review fleet metrics and the operator
audit trail.

Related apps in this repository:

- [`../api`](../api): the API this console consumes (operator plane under /api/v1/operator, port 5066) and the tenant-tier CRM API
- [`../web`](../web): tenant-facing SPA

## Stack

React 19 + Vite 6 + TypeScript strict, react-router-dom 7, TanStack Query v5,
Zustand (persisted auth), axios, Tailwind CSS 3.4 with vendored shadcn-style
Radix components, lucide-react, sonner. Fonts: Geist Variable + Geist Mono
Variable. Dark theme by default with an optional light toggle.

## Quick start

```bash
pnpm install
cp .env.example .env        # VITE_API_BASE_URL, defaults to http://localhost:5066/api/v1/operator
pnpm dev                    # http://localhost:3580
```

Requires apps/api (operator plane) running and the shared database seeded
(see `../api`). Demo operator login:
`root@example.com` / `operator123`.

## Pages

| Route | What it does |
|---|---|
| `/login` | operator sign-in |
| `/` | platform overview: tenant health, totals, plan distribution, recent operator activity |
| `/tenants` | searchable fleet table + the two-step Onboard Tenant wizard (workspace + plan, then admin user; entitlements snapshot on submit) |
| `/tenants/:id` | tenant detail: suspend/activate, plan change (re-snapshots PLAN entitlements, preserves ADMIN overrides), usage, admin users, per-row entitlement editor |
| `/plans` | plan cards with module picker and limits; editing a plan never mutates existing tenants |
| `/operators` | operator accounts (SUPERADMIN manages; OPERATOR role is read-only) |
| `/audit` | filterable operator audit trail |

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Vite dev server on 3580 |
| `pnpm build` / `pnpm preview` | production build / serve it |
| `pnpm lint` / `pnpm typecheck` | eslint / tsc |
