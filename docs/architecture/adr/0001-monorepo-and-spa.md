# ADR 0001: One monorepo, one API, two SPAs

## Status

Accepted.

## Context

Euron Open CRM has three kinds of caller: workspace staff in a browser, the operator's own
staff in a browser, and connected products sending data from servers and web pages. They share
one data model (tenants, entitlements, leads, events) and many services. The project started as
separate repositories for the tenant API, the operator API and each frontend, with the operator
API keeping a hand-maintained mirror of part of the schema; changes had to land in several
places at once and the mirror drifted.

## Decision

- One pnpm workspace driven by Turborepo ([`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml),
  [`turbo.json`](../../../turbo.json)) with `apps/api`, `apps/web`, `apps/console` and
  `packages/sdk`.
- One Express 5 API serves all three planes on separate prefixes: `/api/v1` (tenant),
  `/api/v1/operator` and `/api/v1/ingest` ([`apps/api/src/app.ts`](../../../apps/api/src/app.ts)).
  The operator plane has its own routes, controllers, services and repositories under
  `operator/` folders and its own token type.
- Layers are routes, controllers, services, repositories and Kysely. Services and repositories
  are singletons; repositories accept an optional transaction.
- The API runs as a Node cluster; one worker owns background jobs
  ([`apps/api/src/index.ts`](../../../apps/api/src/index.ts)). There is no separate worker
  service.
- The two frontends are static single-page apps built with Vite (React 19, TanStack Query,
  Zustand), deployable to any static host or CDN. Neither needs a server runtime.
- `@open-crm/sdk` ([`packages/sdk`](../../../packages/sdk)) is a dependency-free server client
  for the ingest API.

## Consequences

Positive:

- One schema, one set of types, one migration history; no mirrored schema to keep in sync.
- A change that spans planes (for example, a new module key used by the plan editor, the
  gating map and the navigation) is one pull request.
- The SPAs are cheap to host and cache, and the API is the only thing that scales.

Trade-offs:

- The operator plane and the tenant plane share a process and a `JWT_SECRET`. They are kept
  apart by the token `type` claim and separate middleware, not by network boundaries.
- Background jobs share CPU with request handling on one worker per task.
- The two SPAs each carry their own copy of the UI kit (`components/ui`); there is no shared
  UI package yet.

## Alternatives considered

- **Separate services per plane.** Stronger isolation, but two deployments, a cross-service
  contract and the schema mirror this project set out to remove.
- **A server-rendered frontend (Next.js).** Not needed: every page is behind sign-in except the
  public booking page, and a static SPA has no server to run or patch.
