# Security architecture

The controls Euron Open CRM relies on, where each lives in the code, and what it does not
cover yet. The STRIDE analysis is [threat-model.md](threat-model.md). How to report a
vulnerability: [SECURITY.md](../../SECURITY.md). Paths are relative to the repository root.

## 1. Authentication

| Control | Where | Detail |
| --- | --- | --- |
| Password hashing | [`services/auth.service.ts`](../../apps/api/src/services/auth.service.ts), [`services/users.service.ts`](../../apps/api/src/services/users.service.ts) | bcrypt, cost 12 |
| Password length | same, and [`services/operator/auth.service.ts`](../../apps/api/src/services/operator/auth.service.ts) | At least 8 characters on reset and change; no other policy |
| Sign-in | [`auth.service.ts`](../../apps/api/src/services/auth.service.ts) | Email and password only. An email may exist in several workspaces: every candidate is compared and a fully active account is preferred. There is no endpoint that lists tenants |
| Timing | same | An unknown email still pays one bcrypt comparison against a dummy hash, so response time does not reveal whether an account exists. The operator sign-in does not do this |
| Generic answers | same | `Invalid email or password` for an unknown email and a wrong password alike. Forgot password always answers success |
| Brute force | [`middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts) | Sign-in: 10 per 5 min per IP and 5 per 5 min per email. Forgot password: 5 per 15 min per IP, 3 per email. Reset: 10 per 15 min per IP. Same limits on the operator plane |
| Password reset | [`utils/jwt.util.ts`](../../apps/api/src/utils/jwt.util.ts) | A JWT valid 1 hour, signed with `JWT_SECRET` plus the user's current password hash, so it stops verifying once the password changes. Single use without a table |
| Invitations | [`users.service.ts`](../../apps/api/src/services/users.service.ts), [`utils/password.ts`](../../apps/api/src/utils/password.ts) | When no password is given, a 14-character CSPRNG password is generated and emailed to the new member in clear |
| Account and workspace status | [`middlewares/auth.middleware.ts`](../../apps/api/src/middlewares/auth.middleware.ts) | Every request reloads the user joined to its tenant: a user not `ACTIVE` gets 401, a tenant not `ACTIVE` gets 403 |

## 2. Tokens

- HS256 JWTs signed with `JWT_SECRET`, valid `JWT_EXPIRY` (12 hours by default,
  [`config/index.ts`](../../apps/api/src/config/index.ts)).
- Tenant tokens carry `{ id, tenantId, role, type: "tenant" }`; operator tokens
  `{ id, role, type: "operator" }`. Each verifier refuses the other `type`, so a tenant token
  never opens the operator plane even though both share the secret
  ([`utils/jwt.util.ts`](../../apps/api/src/utils/jwt.util.ts)).
- The token's role is not trusted for authorisation: the user's role and permissions are read
  from the database on every request ([rbac.md](rbac.md#7-limits-of-the-model)).
- Sign-out records an audit event; there is no server session to destroy, so the token stays
  valid until it expires.
- Both SPAs keep the token in `localStorage` through Zustand `persist`
  ([`apps/web/src/stores/auth-store.ts`](../../apps/web/src/stores/auth-store.ts),
  [`apps/console/src/stores/auth-store.ts`](../../apps/console/src/stores/auth-store.ts)).
  No cookie is used, so there is no CSRF surface, and any script running in the page can read
  the token.

## 3. Authorisation

Two gates on every module route, in order: what the tenant bought (entitlement), then what the
user's role allows (RBAC) ([`middlewares/module.middleware.ts`](../../apps/api/src/middlewares/module.middleware.ts),
[rbac.md](rbac.md)). Setup and administration routes are guarded by governance capabilities
(`channels`, `team`, `billing`, `settings`); payment gateway configuration and per-user
permission overrides are `ADMIN` only, and override keys are validated ([rbac.md](rbac.md#per-user-overrides)).
Ownership-changing and destructive record actions follow
[`utils/record-policy.ts`](../../apps/api/src/utils/record-policy.ts). Operator writes need
`SUPERADMIN`.

## 4. Tenant isolation

- One schema; every tenant table has `tenant_id` and every repository query filters on it
  ([ADR 0002](adr/0002-multi-tenant-shared-schema.md)). `authenticateUser` takes the tenant
  from the token and checks the user row belongs to it.
- A record of another tenant is answered exactly like a missing one (404), because the lookup
  includes `tenant_id`.
- Inbound callers that carry no JWT are bound to one tenant by what they present: an API key
  resolves to one tenant and one connected product, so a producer never names its tenant in a
  payload ([`middlewares/api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts));
  WhatsApp callbacks resolve by per-tenant URL token or by `waba_id`; Exotel callbacks by the
  per-tenant URL token; public booking by tenant slug and link slug.
- The copilot's tools are read-only and take the tenant from the authenticated user, never
  from the model's output ([ai.md](ai.md)).

## 5. API keys and ingest

| Control | Detail |
| --- | --- |
| Format | `crm_sk_` (secret) or `crm_pk_` (publishable) plus 32 hex characters (128 bits) from `crypto.randomBytes` ([`services/connected-apps.service.ts`](../../apps/api/src/services/connected-apps.service.ts)). Shown once |
| Storage | SHA-256 of the key in `api_keys.key_hash`, plus a short display prefix. A database dump does not yield working keys |
| Lookup | One indexed equality on the hash, joined to the tenant, which must be `ACTIVE` ([`integrations.repository.ts`](../../apps/api/src/repositories/integrations.repository.ts)). A missing key, a revoked key and a key of a suspended or closed workspace all answer `401 Invalid or revoked API key` |
| Publishable keys | Accepted only from an origin (or referer) in the connected product's `allowed_origins`. Can only identify and send events; catalog, batch, lead and health routes need a secret key (`requireSecretKey`) |
| Keys in URLs | `?k=` exists for `navigator.sendBeacon` and is accepted only for publishable keys. A secret key in a URL is refused with an explanation |
| Paused or disabled product | 403 before any write |
| Limits | Separate per-key buckets for leads, events and catalog sync. Publishable-key calls to `/identify` and `/events` also pass a per-key, per-IP bucket (240 per minute), so one busy page cannot drain the key's events budget |
| No-code lead form | `POST /ingest/leads/t/:token` with the workspace ingest token (`lit_...`), rotatable by `settings` holders |

Details: [product-integration.md](product-integration.md).

## 6. Webhooks

### Inbound

| Source | Mount | Verification |
| --- | --- | --- |
| WhatsApp Cloud API | `/api/v1/wa/webhooks` | Raw body kept; `X-Hub-Signature-256` HMAC-SHA256 with the app secret, constant-time compare ([`controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts)). Subscription handshake with the verify token. When no app secret is configured (no `META_APP_SECRET` on the shared path, no stored app secret on the per-tenant path), production (`NODE_ENV=production`) answers `401 Webhook signing secret not configured`; outside production the payload is processed unverified with a warning |
| Exotel | `/api/v1/telephony/webhooks/exotel` | Exotel signs nothing; the per-tenant `webhook_token` (48 hex characters) in the URL is the credential ([../guides/telephony-exotel.md](../guides/telephony-exotel.md)) |
| Razorpay (platform billing) | `/api/v1/operator/webhooks/razorpay` | `X-Razorpay-Signature`, HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, constant-time ([`services/razorpay.client.ts`](../../apps/api/src/services/razorpay.client.ts)) |
| Stripe (platform billing) | `/api/v1/operator/webhooks/stripe` | `Stripe-Signature` `t=...,v1=...` over `t.body` with `STRIPE_WEBHOOK_SECRET`, constant-time ([`services/stripe.client.ts`](../../apps/api/src/services/stripe.client.ts)). The timestamp is not checked for age; replays of one event are absorbed by the `platform_webhook_events.event_id` unique key |

All four are mounted before the JSON parser and outside the global rate limiter
([`app.ts`](../../apps/api/src/app.ts)).

### Outbound

Webhooks to subscribed endpoints and product actions are signed with
[`utils/webhook-signature.ts`](../../apps/api/src/utils/webhook-signature.ts): header
`X-CRM-Signature: t=<unix>,v1=<hex>` where `v1` is HMAC-SHA256 of `"<t>.<body>"` with the
endpoint's secret, alongside `X-CRM-Event` and `X-CRM-Delivery`. Receivers should refuse
timestamps older than 5 minutes. Secrets are stored sealed.

Every URL the server calls on a tenant's behalf (webhook endpoints, product action endpoints,
PULL catalog feeds) goes through [`utils/http-guard.ts`](../../apps/api/src/utils/http-guard.ts):
HTTPS only, no credentials in the URL, the host must not resolve to a private, loopback,
link-local, metadata or CGNAT address (rechecked on every call against DNS rebinding), a
10 second timeout and a response size cap.

## 7. Provider credentials

Tenant-supplied secrets (WhatsApp access token, app secret and registration PIN, Twilio auth
token, Exotel API key and token, Razorpay key secret, Stripe secret key, Google OAuth tokens,
integration credentials, webhook signing secrets, product action secrets) are encrypted with
AES-256-GCM in [`utils/crypto.ts`](../../apps/api/src/utils/crypto.ts):

- the key is SHA-256 of `CREDENTIALS_ENCRYPTION_KEY`; a random 12-byte IV per value; stored as
  `base64(iv).base64(tag).base64(ciphertext)`;
- `sealSecret` prefixes `enc:v1:` for columns that may still hold legacy plaintext, and
  `openSecret` returns unprefixed values unchanged;
- no endpoint returns a stored secret. Config responses say whether a secret is set, not what
  it is ([ADR 0005](adr/0005-byo-provider-credentials-encrypted.md)).

Platform-level provider keys (SES, the platform WhatsApp number, Twilio, Razorpay, Stripe,
AI providers, Google OAuth client) come from the environment.

## 8. Files

[`services/storage.service.ts`](../../apps/api/src/services/storage.service.ts): with
`AWS_S3_BUCKET` set, objects go to S3 and downloads are presigned URLs (1 hour by default).
Without it, files go to `LOCAL_STORAGE_DIR` and are served only by `/local-files/*key` with an
`expires` and an HMAC-SHA256 `sig` (key derived from `JWT_SECRET`), compared in constant time;
the resolved path must stay inside the storage root.

## 9. HTTP surface

| Control | Where | Detail |
| --- | --- | --- |
| CORS | [`app.ts`](../../apps/api/src/app.ts) | Allow-list from `CORS_ORIGINS`, default the two SPA origins; `*` is ignored. `/api/v1/ingest/*` answers any origin, because the tracker runs on connected products' own sites; publishable keys stay origin-locked by the key middleware. No credentials mode is used anywhere (bearer tokens and API keys, not cookies). `X-API-Key` is an allowed header |
| Client IP | `trust proxy` = `TRUST_PROXY` | Must equal the number of proxies in front, or rate limits key on the wrong address |
| Headers | `helmet()` | Defaults, with `Cross-Origin-Resource-Policy: cross-origin` |
| Body size | `express.json` | 10 MB; 2 MB on the billing webhooks |
| Errors | [`error-handler.middleware.ts`](../../apps/api/src/middlewares/error-handler.middleware.ts) | In production an unexpected exception answers 500 with `Internal Server Error` and a `rayId`; the exception text stays in the log |
| Rate limits | [`rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts) | 600 per minute per IP across the API, stricter buckets on auth, booking, ingest and LLM routes ([LLD.md](LLD.md#4-rate-limits)). Redis-backed when configured, in-process otherwise; a Redis error fails open |
| Input | [`validators`](../../apps/api/src/validators) | zod on 12 route files; other handlers validate in their services. Unknown fields are tolerated |
| SQL | Kysely everywhere | Parameterised queries; raw `sql` fragments bind values |
| Unsubscribe links | [`utils/unsubscribe.ts`](../../apps/api/src/utils/unsubscribe.ts) | HMAC-signed tokens, constant-time compare |
| Google OAuth | [`services/google-calendar.service.ts`](../../apps/api/src/services/google-calendar.service.ts) | `state` is HMAC-signed and carries the tenant and user, so the public callback trusts nothing else |

## 10. The production guard

`assertProductionConfig` ([`config/index.ts`](../../apps/api/src/config/index.ts)) runs before
the cluster starts and refuses `NODE_ENV=production` when:

- `JWT_SECRET` is the development default or shorter than 32 characters;
- `CREDENTIALS_ENCRYPTION_KEY` is the development default or shorter than 32 characters;
- `CORS_ORIGINS` ends up empty.

It does not check provider settings or the `*_SIMULATE` flags: a production deployment with no
SES keys, or with `WHATSAPP_SIMULATE=true`, runs that channel simulated without complaint.

## 11. Known gaps

These are real limitations of this release, not hypotheticals.

| Gap | Effect | Mitigation today |
| --- | --- | --- |
| Bearer token in `localStorage` | A cross-site scripting bug in either SPA can read the token | React escapes output; keep dependencies current |
| Tokens are not revocable | No server sessions yet. A stolen token works for up to `JWT_EXPIRY` (12 h). Sign-out only drops it client-side | Disabling the user or suspending the tenant blocks it at the next request; rotating `JWT_SECRET` ends every session |
| No two-factor authentication | A leaked password is enough to sign in, on both planes | Rate limits on sign-in |
| Workflow engine and audit writes are in-process and best-effort | No outbox and no retry: a crash between a commit and its workflow run, audit row or notification loses that side effect, silently except for a log line | Outbound webhooks do have a durable queue with retries |
| Entitlement and role caches are per process | A plan change, override or role edit can take up to 60 s to reach other workers and tasks | Edits invalidate the cache on the worker that handled them |
| One AES key, no key versioning, no KMS envelope | Rotating `CREDENTIALS_ENCRYPTION_KEY` makes every stored secret unreadable; there is no re-encryption tool. A database dump plus this key reveals every tenant secret | Keep the key in a secrets manager and apart from database access |
| Inbound URL tokens are stored and shown in plaintext | The ingest token, the WhatsApp verify token and the Exotel webhook token are kept in clear (they must be pasted into the provider's console) and shown to workspace admins | Rotate the ingest token from settings; the tokens grant write access to one tenant's inbound path only |
| Copilot tools ignore the user's modules | The copilot is tenant-scoped, but a role with `copilot` and without, say, `deals` can still ask about deals ([ai.md](ai.md)) | Leave `copilot` off roles that must not see other modules' data |
| Platform-sender email skips reputation controls | The reputation gate, suppression list and per-tenant throttle apply on tenant sending domains; mail through the platform sender bypasses them ([channels.md](channels.md)) | Give sending tenants their own domain |
| Unsubscribe tokens never expire | An old unsubscribe link keeps working | They only unsubscribe the address they were minted for |
| Stripe webhook timestamp not checked | A captured platform billing event can be replayed | The event id is deduplicated, so a replay does not apply twice |
| Operator sign-in timing | An unknown operator email answers faster than a wrong password | Rate limits; operator emails are few |
| Invitation emails contain a password | Generated passwords travel in clear by email | Members should change it after first sign-in; there is no forced change |
| Logs are not redacted | The Winston logger prints messages as given ([`utils/logger.ts`](../../apps/api/src/utils/logger.ts)) | Code avoids logging secrets; review new log lines |
| The two SPAs duplicate their UI kit | Fixes to shared components must be made twice | |
| Some very large page files | For example [`leads.tsx`](../../apps/web/src/pages/leads.tsx), [`lead-detail.tsx`](../../apps/web/src/pages/lead-detail.tsx), [`users.tsx`](../../apps/web/src/pages/users.tsx) are well over a thousand lines each, which makes review harder | |
