# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.x (latest minor) | Yes |
| Older minors | No |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository ("Security" tab, "Report a vulnerability"):
https://github.com/euron-sde-team/euron-open-crm/security/advisories/new

Please include:

- the affected component (`apps/api`, `apps/web`, `apps/console`, `packages/sdk`,
  `infra/terraform/...`) and version or commit,
- a description of the issue and its impact,
- steps to reproduce, or a proof of concept (against your own deployment or the local
  stack, never someone else's),
- any suggested mitigation.

What to expect:

| Stage | Target |
| ----- | ------ |
| Acknowledgement | within 3 business days |
| Initial assessment and severity | within 7 business days |
| Fix or mitigation for critical / high issues | within 30 days |
| Coordinated public disclosure | after a fix is released, credited to you unless you prefer otherwise |

## Scope

In scope: the code in this repository and the infrastructure it provisions with its
default settings. We are most interested in:

- **Tenant isolation.** Reading or changing another workspace's leads, contacts, deals,
  conversations, tickets, invoices, files, call recordings, API keys or audit log; any
  query path that is not scoped by `tenant_id`.
- **Authentication and authorisation.** Signing in as someone else, forging or reusing a
  token across the tenant and operator planes, password reset flaws, sign-in rate limits
  that can be sidestepped, reaching a module the plan or the role does not grant.
- **Entitlements and billing.** Using a module or a limit the plan does not include,
  activating or extending a subscription without paying (forged or replayed Razorpay or
  Stripe webhooks), a payment credited twice.
- **Credentials.** Any way to make the API return, log or store a tenant's provider
  credentials (Twilio, Exotel, WhatsApp, Razorpay, Stripe, integration keys, webhook
  signing secrets) in clear, or recovering an ingest API key from what the server stores.
- **Inbound endpoints.** Forging WhatsApp, Exotel, Razorpay or Stripe callbacks, ingest
  events attributed to another workspace, a publishable key doing what only a secret key
  may, the public booking page creating data it should not.
- **Server-side requests.** Making the API call a URL a caller chose outside the documented
  webhook and catalogue-feed paths (which are SSRF guarded).
- **Files.** Reading a stored file without a valid, unexpired signed link.

Out of scope:

- **What admins can already do.** Workspace admins manage their own users, roles, channels
  and data; operators manage tenants, plans and billing. Reports that rely on that access
  are out of scope; reports that let someone gain it are very much in scope.
- **Documented gaps** listed in
  [docs/architecture/security.md](docs/architecture/security.md#known-gaps), such as bearer
  tokens that are not revocable before they expire.
- **The demo seed.** `make demo` creates well-known demo accounts on purpose and refuses to
  run with `NODE_ENV=production`.
- **Simulated providers.** The `*_SIMULATE` modes exist for local development and tests.
- Findings that require a compromised host, compromised AWS account, or leaked deployment
  secrets.
- Denial of service through resource exhaustion of a deployment you operate yourself.

## Hardening checklist for operators

- Deploy with the Terraform in `infra/terraform` (or match it): private subnets, TLS
  everywhere, encryption at rest with a customer-managed key, Redis with TLS, secrets only
  in Secrets Manager.
- Keep `NODE_ENV=production`: the API refuses to boot with the development `JWT_SECRET`
  or `CREDENTIALS_ENCRYPTION_KEY`, with short ones, or without `CORS_ORIGINS`.
- Keep `CREDENTIALS_ENCRYPTION_KEY` in Secrets Manager and back it up: without it every
  tenant has to enter their provider credentials again.
- Set `TRUST_PROXY` to the number of proxies in front of the API (1 behind the ALB, 2
  behind CloudFront and the ALB) so rate limits see the real client address.
- Turn every `*_SIMULATE` flag off, and set the Razorpay and Stripe webhook secrets before
  taking real payments.
- Point SES, WhatsApp and Twilio at accounts you control, and keep the platform sender on a
  verified domain with DKIM.
- Subscribe someone to the alarm topic (`alarm_email`).
