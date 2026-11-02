# Threat model

A STRIDE pass over Euron Open CRM: what is worth stealing or abusing, where trust changes,
what stops each threat, and what is left. The controls themselves are in
[security.md](security.md).

## Assets

| Asset | Why it matters |
| --- | --- |
| Tenant CRM data | Leads, contacts, deals, conversations, call recordings and transcripts: personal data of the tenant's customers |
| Tenant isolation | One workspace reading or writing another's data is the worst failure of a multi-tenant system |
| Provider credentials | A tenant's WhatsApp, Twilio, Exotel, Razorpay or Stripe secret can send messages, place calls or move money on that tenant's account |
| `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` | The first mints any session; the second decrypts every stored provider secret |
| Sessions | A tenant token opens a workspace; an operator token opens every tenant's plan and subscription |
| Workspace API keys | A secret key writes a tenant's catalog, leads and events |
| Entitlements and subscriptions | Decide what a tenant gets without paying |
| Sending reputation | One tenant's spam can harm the shared SES account and other tenants' delivery |

## Trust boundaries

1. **Browser to the API.** Workspace staff and operator staff with bearer tokens; anyone on the
   internet without one.
2. **Connected product to `/api/v1/ingest`.** Server code with a secret key; arbitrary browsers
   with a publishable key.
3. **Providers to webhook mounts.** Meta, Exotel, Razorpay and Stripe calling unauthenticated
   URLs that must prove themselves by signature or by an unguessable token.
4. **API to tenant-supplied URLs.** Webhook endpoints, product action endpoints and catalog
   feeds chosen by tenants.
5. **API to AI providers.** CRM data leaves the deployment in prompts when a provider key is set.
6. **API to Postgres, Redis and S3.** Trusted, inside private networking.

## STRIDE

| Threat | Example | Mitigation |
| --- | --- | --- |
| **Spoofing** | Guessing or stuffing a password | bcrypt cost 12; per-IP and per-email sign-in limits; equal timing for unknown emails on the tenant plane |
| | Using a tenant token on the operator plane | Distinct `type` claim checked by each verifier |
| | Forging a WhatsApp or billing webhook | HMAC over the raw body with the provider secret, constant-time compare, before parsing. In production a WhatsApp webhook with no signing secret configured is refused (401); only development processes it unverified |
| | Forging an Exotel callback | 192-bit per-tenant URL token; Exotel offers no signature |
| | Using a publishable key from another site | Origin allow-list per connected product; publishable keys cannot write catalogs or read anything |
| **Tampering** | Writing to another tenant's records by id | Every repository query includes `tenant_id`; misses answer 404 |
| | A producer writing another product's catalog | The key resolves to exactly one connected product; payloads cannot name another |
| | Reassigning or deleting a colleague's records | Record policy: owner or elevated role for delete and reassignment; bulk actions elevated only |
| **Repudiation** | Denying a sign-in, a role change or a token rotation | `audit_logs` rows for sign-in and sign-out (with IP and user agent), user and role changes, key and token rotation; operator actions in `operator_audit_logs` |
| **Information disclosure** | Reading provider secrets from the UI or an API response | Write-only: never returned |
| | Reading provider secrets from a database dump | AES-256-GCM with a key held outside the database |
| | Reading another tenant's files | S3 presigned or HMAC-signed local links, minted only after an authenticated, tenant-scoped lookup |
| | Copilot leaking another tenant's data | Read-only tools that take the tenant from the session, never from the model. They are not limited to the user's own modules |
| | SSRF through a tenant-supplied URL | HTTPS only, private and metadata ranges refused, DNS rechecked per call, timeouts and size caps |
| **Denial of service** | Flooding the API | 600 per minute per IP, stricter per-route buckets, 10 MB body limit |
| | Flooding ingest from one product | Separate per-key buckets for leads, events and catalog sync, plus a per-key, per-IP bucket for browser calls |
| | Draining AI spend | 20 copilot or agent requests per minute per user |
| | One tenant's mail ruining shared reputation | Per-tenant send throttle, reputation states that throttle and pause a tenant, suppressions ([channels.md](channels.md)) |
| **Elevation of privilege** | A sales agent opening admin pages | Entitlement then RBAC on every module route; capabilities on setup routes; the SPA hides what the API refuses |
| | A manager promoting themselves to admin | Only an `ADMIN` can assign or modify elevated roles or set per-user permission overrides, and override keys are validated (`*` refused) |
| | Using the workspace while unpaid | Plan snapshot into entitlements; dunning sweep suspends lapsed tenants; suspended tenants get 403 on every request |

## Residual risks

### Stolen bearer token

Tokens live in `localStorage` and cannot be revoked one by one. An XSS bug or a compromised
browser gives up to 12 hours of access. Disabling the user, suspending the tenant or rotating
`JWT_SECRET` (which signs everyone out) are the levers.

### No second factor

A phished password is a full sign-in on either plane.

### Compromised `CREDENTIALS_ENCRYPTION_KEY` with a dump

Together they reveal every tenant's provider credentials. There is no key versioning or
envelope encryption yet, so the response is to rotate every provider secret at the providers.

### Lost side effects

Workflow runs, audit rows and notifications are best-effort and in-process. A crash can drop
an audit row or a workflow action without an error to the user.

### Stale caches

Up to 60 seconds after a downgrade, suspension of a module, or role edit, other workers may
still allow the old access. Tenant suspension itself is not cached: it is read on every request.

### Prompts sent to AI providers

With an AI key configured, lead, deal, ticket and call content is sent to that provider. Use
the offline provider (no key) where that is not acceptable ([ai.md](ai.md)).

### Plaintext inbound tokens

The ingest token, WhatsApp verify token and Exotel webhook token are stored in clear and shown
to admins. Anyone who reads them can submit leads, or Exotel callbacks, into that tenant.
