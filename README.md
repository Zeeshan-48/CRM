<p align="center">
  <img src="docs/assets/banner.svg" alt="Euron Open CRM: every customer, one workspace. Leads, deals, email and WhatsApp, tickets, calls and product signals, for many workspaces on one deployment you run" width="100%">
</p>

<p align="center">
  <img alt="Open source" src="https://img.shields.io/badge/open_source-%E2%9D%A4-c0267e?style=flat">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3b82f6?style=flat"></a>
  <img alt="Node.js 22 LTS" src="https://img.shields.io/badge/node-22_LTS-339933?style=flat&logo=nodedotjs&logoColor=white">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat&logo=typescript&logoColor=white">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat&logo=react&logoColor=white">
  <img alt="Express 5" src="https://img.shields.io/badge/Express-5-000000?style=flat&logo=express&logoColor=white">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169e1?style=flat&logo=postgresql&logoColor=white">
  <img alt="Redis 7" src="https://img.shields.io/badge/Redis-7-dc382d?style=flat&logo=redis&logoColor=white">
  <img alt="Multi-tenant" src="https://img.shields.io/badge/multi--tenant-yes-c0267e?style=flat">
  <img alt="WhatsApp Cloud API" src="https://img.shields.io/badge/WhatsApp-Cloud_API-25d366?style=flat&logo=whatsapp&logoColor=white">
  <img alt="Amazon SES" src="https://img.shields.io/badge/email-Amazon_SES-dd344c?style=flat&logo=amazonsimpleemailservice&logoColor=white">
  <img alt="Twilio and Exotel" src="https://img.shields.io/badge/telephony-Twilio_%2B_Exotel-f22f46?style=flat&logo=twilio&logoColor=white">
  <img alt="Stripe" src="https://img.shields.io/badge/payments-Stripe-635bff?style=flat&logo=stripe&logoColor=white">
  <img alt="Razorpay" src="https://img.shields.io/badge/payments-Razorpay-0c2451?style=flat&logo=razorpay&logoColor=white">
  <img alt="Terraform" src="https://img.shields.io/badge/IaC-Terraform-7b42bc?style=flat&logo=terraform&logoColor=white">
  <img alt="AWS" src="https://img.shields.io/badge/AWS-ready-ff9900?style=flat&logo=amazonwebservices&logoColor=white">
</p>

<p align="center">
  <a href="https://github.com/euron-sde-team/euron-open-crm/stargazers"><img alt="Star this repo" src="https://img.shields.io/github/stars/euron-sde-team/euron-open-crm?style=social&label=Star%20this%20repo"></a>
  <a href="https://github.com/euron-sde-team/euron-open-crm/fork"><img alt="Fork" src="https://img.shields.io/github/forks/euron-sde-team/euron-open-crm?style=social&label=Fork"></a>
  <a href="https://github.com/euron-sde-team/euron-open-crm/watchers"><img alt="Watch" src="https://img.shields.io/github/watchers/euron-sde-team/euron-open-crm?style=social&label=Watch"></a>
  <br>
  <a href="https://github.com/euron-sde-team/euron-open-crm/issues"><img alt="Open issues" src="https://img.shields.io/github/issues/euron-sde-team/euron-open-crm?style=flat&color=c0267e"></a>
  <a href="https://github.com/euron-sde-team/euron-open-crm/pulls"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-34d399?style=flat"></a>
  <a href="https://github.com/euron-sde-team/euron-open-crm/commits/main"><img alt="Last commit" src="https://img.shields.io/github/last-commit/euron-sde-team/euron-open-crm?style=flat&color=8b95a8"></a>
  <img alt="Runs locally with no provider account" src="https://img.shields.io/badge/runs_locally-no_accounts_needed-0a0f1c?style=flat">
  <br>
  <a href="#built-by-the-team-behind-euron"><img alt="Built by the team behind Euron" src="https://img.shields.io/badge/built_by-Euron-4f46e5?style=flat"></a>
</p>

<p align="center">
  <b><a href="#-quickstart">Quickstart</a></b> ·
  <b><a href="#️-architecture">Architecture</a></b> ·
  <b><a href="#-explore-the-repository">Explore the repo</a></b> ·
  <b><a href="docs/guides/integrate-your-product.md">Integrate your product</a></b> ·
  <b><a href="#️-deploy-to-aws">Deploy</a></b> ·
  <b><a href="docs/architecture/security.md">Security</a></b> ·
  <b><a href="#-documentation">Docs</a></b>
</p>

**Euron Open CRM** is an open-source, self-hosted, **multi-tenant CRM**: one deployment serves
many separate workspaces, each with its own users, roles, data, channels and branding, and an
**operator console** that sells plans, snapshots them into entitlements and bills each
workspace through Stripe or Razorpay. Inside a workspace, sales and support teams work leads,
contacts, accounts and a deal pipeline; talk to customers over **email and WhatsApp** in one
inbox; run campaigns, tickets with SLAs and trigger-based workflows; call leads through
**Twilio or Exotel** with recordings and AI call summaries; ask an **AI copilot** about their
data; and see which people are acting like buyers inside **their own product**, fed by an
ingest API, a server SDK and a browser tracker. It is MIT-licensed and part of the open-source
initiative of **ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED**.

The parts that usually go wrong in a multi-tenant CRM are designed in, not bolted on:

- **Workspaces never see each other.** Every tenant table carries `tenant_id`, every query is
  scoped by it, and another workspace's record is a 404. The test suite proves it module by
  module against two seeded workspaces.
- **What a workspace bought is what it gets.** Plans are sales artifacts; at onboarding the
  operator snapshots a plan into entitlement rows, and the runtime reads only those. Each
  module route passes the entitlement gate first, then role-based access, from one reviewable
  map.
- **Each workspace brings its own providers.** WhatsApp, Twilio, Exotel, Razorpay and Stripe
  credentials are per tenant, encrypted at rest with AES-256-GCM, and write-only: no endpoint
  ever returns them.
- **Product signals are first-class.** Events from a connected product resolve to the right
  person (anonymous visitors are back-filled when they identify), fold into an intent score
  that decays, and land in the same timeline as emails, calls and meetings. Unknown events are
  accepted and queued for review, never dropped.
- **It runs with no accounts at all.** Every provider has a simulated mode and AI has a
  deterministic offline engine, so the whole product, and its test suite, works on a laptop.

<p align="center">
  <img src="docs/assets/tour.gif" alt="Product tour: sign-in, the dashboard, leads, a lead's detail with its score, the pipeline, a WhatsApp conversation, buying signals from a connected product, workflows, the AI copilot, dark mode, and the operator console's tenants and a tenant's entitlements" width="100%">
</p>

> [!NOTE]
> Everything in the tour and the screenshots ran for real on a laptop: `make up && make demo`
> brings up the API, both apps, Postgres, Redis and an AWS emulator, and seeds two fictional
> workspaces. Providers run in their simulated modes; connect a real one and the same screens
> work against it ([connect-providers.md](docs/guides/connect-providers.md)).

<h3 align="center">Built by the team behind Euron</h3>

<p align="center">
  <sub>Euron Open CRM is part of the open-source initiative of ENGAGESPHERE TECHNOLOGY PRIVATE LIMITED, made by the people who build<br>the platforms below. If you like how this repository is built, come and see what we build with it.</sub>
</p>

<p align="center">
  <a href="https://euron.one"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-dark.svg"><img src="docs/assets/brand/euron-light.svg" alt="Euron: learn the latest technologies from industry experts. Visit euron.one" width="31%"></picture></a>
  <a href="https://euronsystems.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/euron-systems-dark.svg"><img src="docs/assets/brand/euron-systems-light.svg" alt="Euron Systems: the SaaS platform for educators and creators. Visit euronsystems.com" width="31%"></picture></a>
  <a href="https://alphaeuron.com"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/brand/alpha-euron-dark.svg"><img src="docs/assets/brand/alpha-euron-light.svg" alt="Alpha Euron: where school kids grow creativity and tech skills with AI. Visit alphaeuron.com" width="31%"></picture></a>
</p>

<p align="center">
  <a href="https://www.instagram.com/euron_official"><img src="https://img.shields.io/badge/Instagram-E4405F?style=flat-square&logo=instagram&logoColor=white" alt="Instagram"></a>
  <a href="https://www.linkedin.com/company/euronone/posts/"><img src="https://img.shields.io/badge/LinkedIn-0A66C2?style=flat-square&logo=linkedin&logoColor=white" alt="LinkedIn"></a>
  <a href="https://x.com/euron712"><img src="https://img.shields.io/badge/X-000000?style=flat-square&logo=x&logoColor=white" alt="X"></a>
  <a href="https://www.youtube.com/@Euron-official"><img src="https://img.shields.io/badge/YouTube-FF0000?style=flat-square&logo=youtube&logoColor=white" alt="YouTube"></a>
  <a href="https://whatsapp.com/channel/0029VaeeJwq9RZAfPW9P2l07"><img src="https://img.shields.io/badge/WhatsApp_channel-25D366?style=flat-square&logo=whatsapp&logoColor=white" alt="WhatsApp channel"></a>
</p>

---

## 📚 Table of contents

- [Why Euron Open CRM](#-why-euron-open-crm)
- [At a glance](#-at-a-glance)
- [Screenshots](#️-screenshots)
- [Features](#-features)
- [Architecture](#️-architecture)
- [Tech stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quickstart](#-quickstart)
- [Explore the repository](#-explore-the-repository)
- [API](#-api)
- [Configuration](#️-configuration)
- [Deploy to AWS](#️-deploy-to-aws)
- [Security model](#-security-model)
- [Testing](#-testing)
- [Documentation](#-documentation)
- [Roadmap](#️-roadmap)
- [FAQ](#-faq)
- [Contributing, security and license](#-contributing-security-and-license)

## 💡 Why Euron Open CRM

Most open-source CRMs are built for one company. Running a CRM **for other companies** (an
agency serving clients, a SaaS adding a CRM to its product, a platform team serving business
units) needs more than a `tenant_id` column: plans and limits that are enforced at runtime,
roles that differ per workspace, provider accounts that belong to each workspace, billing for
the workspaces themselves, and a console to run it all. Euron Open CRM ships that operator
layer together with a full sales and service product, and treats your own product's usage as
a sales signal instead of an afterthought.

## 📊 At a glance

| | |
| --- | --- |
| Planes | Workspace app (tenants), operator console (the platform), ingest API (your product) |
| Workspace modules | Leads, contacts, accounts, deals, activities, inbox, WhatsApp, email, campaigns, tickets, knowledge base, calendar, workflows, copilot, AI agents, analytics, finance, products and signals, integrations, audit |
| Roles | 7 built in (Admin, Manager, Sales, Support, Marketing, Finance, HR) plus custom roles and per-user overrides |
| Channels | Email (Amazon SES, your own sending domains), WhatsApp Cloud API, Twilio, Exotel |
| Payments | Each workspace's own Razorpay or Stripe for invoices; the operator's for plan billing |
| AI | OpenAI, Anthropic or Gemini, or a deterministic offline engine |
| Data | 72 tables in one Postgres schema, forward-only SQL migrations |
| Runs on | Docker Compose locally (with an AWS emulator), ECS Fargate + RDS + ElastiCache on AWS |

## 🖼️ Screenshots

| | |
| :---: | :---: |
| <img src="docs/assets/screenshots/01-dashboard.png" alt="Dashboard" width="100%"><br><sub><b>Dashboard.</b> Revenue, weighted pipeline, win rate and an AI forecast for the workspace.</sub> | <img src="docs/assets/screenshots/02-leads.png" alt="Leads" width="100%"><br><sub><b>Leads.</b> Scored on write, filtered by source, tag, status, owner and activity, with saved views.</sub> |
| <img src="docs/assets/screenshots/03-lead-detail.png" alt="Lead detail" width="100%"><br><sub><b>A lead.</b> Journey, engagement, score breakdown, and one timeline of messages, calls and product events.</sub> | <img src="docs/assets/screenshots/04-pipeline.png" alt="Pipeline" width="100%"><br><sub><b>Pipeline.</b> Deals by stage with win probability and health computed when they change.</sub> |
| <img src="docs/assets/screenshots/05-whatsapp-inbox.png" alt="WhatsApp inbox" width="100%"><br><sub><b>WhatsApp.</b> Conversations over the Cloud API with sentiment on every inbound message.</sub> | <img src="docs/assets/screenshots/06-signals.png" alt="Signals" width="100%"><br><sub><b>Signals.</b> People acting like buyers inside your product, ranked by decaying intent.</sub> |
| <img src="docs/assets/screenshots/07-products.png" alt="Products" width="100%"><br><sub><b>Products.</b> The catalogue your product syncs in, with offers agents can quote.</sub> | <img src="docs/assets/screenshots/08-workflows.png" alt="Workflows" width="100%"><br><sub><b>Workflows.</b> Trigger, conditions and actions: assign, message, task, tag, ticket, notify.</sub> |
| <img src="docs/assets/screenshots/09-tickets.png" alt="Tickets" width="100%"><br><sub><b>Tickets.</b> SLA tracking, a board view and AI resolution from the knowledge base.</sub> | <img src="docs/assets/screenshots/10-campaigns.png" alt="Campaigns" width="100%"><br><sub><b>Campaigns.</b> Email and WhatsApp campaigns with spend, revenue, ROI and leads.</sub> |
| <img src="docs/assets/screenshots/11-copilot.png" alt="Copilot" width="100%"><br><sub><b>Copilot.</b> Questions about your data, answered with read-only, workspace-scoped tools.</sub> | <img src="docs/assets/screenshots/12-integrations.png" alt="Integrations" width="100%"><br><sub><b>Integrations.</b> Connected products, lead capture endpoints, API keys and signed webhooks.</sub> |
| <img src="docs/assets/screenshots/13-dashboard-dark.png" alt="Dashboard in dark mode" width="100%"><br><sub><b>Dark mode.</b> Every screen, with the workspace's brand colour adjusted for contrast.</sub> | <img src="docs/assets/screenshots/14-lead-detail-dark.png" alt="Lead detail in dark mode" width="100%"><br><sub><b>A lead, dark.</b> The same detail view in the dark theme.</sub> |
| <img src="docs/assets/screenshots/15-console-tenants.png" alt="Operator console: tenants" width="100%"><br><sub><b>Operator console.</b> Every workspace with its plan, status, seats and leads.</sub> | <img src="docs/assets/screenshots/16-console-tenant-detail.png" alt="Operator console: a tenant" width="100%"><br><sub><b>A tenant.</b> Subscription, admins, billing and entitlements snapshotted from the plan.</sub> |
| <img src="docs/assets/screenshots/17-console-plans.png" alt="Operator console: plans" width="100%"><br><sub><b>Plans.</b> Modules and limits per plan; editing a plan never changes existing tenants.</sub> | <img src="docs/assets/screenshots/00-sign-in.png" alt="Sign in" width="100%"><br><sub><b>Sign in.</b> Each workspace signs in to its own branded app.</sub> |

## ✨ Features

**Sales**
- Leads with deduplication, CSV import, documents, round-robin or territory assignment, and a
  score computed on every write from fit, engagement, recency and product intent.
- Contacts, accounts and contracts; a 360 view per contact with deals, invoices, tickets,
  calls, meetings and product usage.
- A fixed, seven-stage pipeline with line items from your catalogue, win probability and deal
  health; activities, tasks, reminders, saved views and global search.

**Conversations and marketing**
- One inbox for email (inbound through SES) and WhatsApp, with replies, templates and
  sentiment.
- Email from each workspace's own verified domain: DNS records generated for you, sender
  identities, suppressions, bounce and complaint tracking, reputation that throttles sending
  before it hurts the domain.
- WhatsApp Cloud API through Meta Embedded Signup, template sync and delivery status.
- Campaigns over email and WhatsApp with cost, revenue and ROI.

**Service**
- Tickets with priorities, SLA policies, breach tracking, a board view and AI resolution from
  the knowledge base.

**Automation and AI**
- Workflows: a trigger (lead created, deal won, ticket created, product events and more),
  conditions, and actions (assign, WhatsApp, email, task, tag, ticket, notify), with a run log.
- A sales agent that drafts personalised outreach for hot leads for review, with daily caps,
  working hours and multi-step sequences that pause when the lead replies.
- A copilot that answers questions with read-only tools over the workspace's data.
- OpenAI, Anthropic or Gemini when keyed; a deterministic offline engine otherwise.

**Telephony and calendar**
- Click-to-call through Twilio, or Exotel with inbound routing to the right agent (dedicated
  number, then lead owner, then least recently called), a number pool, availability, calling
  hours, recordings mirrored to storage and AI summaries of each call.
- Google Calendar per user with Meet links and free/busy, a Jitsi fallback, and public booking
  pages that turn a booked slot into a lead.

**Finance**
- Invoices, payment links, payments and refunds through each workspace's own Razorpay or
  Stripe account.

**Product integration**
- Connected products with their own API keys (secret for servers, publishable and
  origin-locked for browsers), a catalogue sync in minor units, offers, and identity resolution
  across email, phone and your own user ids.
- An events API, a batch endpoint, a browser tracker, a server SDK (`@open-crm/sdk`), and an
  OpenAPI document served by the API itself.
- Outbound webhooks signed with HMAC, retried with backoff, with a delivery log and replay.

**Operator plane**
- Operators with roles, plans with modules and limits, tenant onboarding, plan changes,
  suspension and entitlement overrides with an audit trail.
- Platform billing through the operator's Stripe or Razorpay: subscriptions, webhooks, a
  dunning sweep with a grace period, and entitlements that follow the subscription.

## 🏗️ Architecture

<p align="center">
  <img src="docs/assets/diagrams/context.svg" alt="System context: workspace users, operators and your product talking to the API, which uses Postgres, Redis, S3, SES and the providers" width="100%">
</p>

One API process serves three planes from one codebase: the **tenant plane** (`/api/v1`) for the
workspace app, the **operator plane** (`/api/v1/operator`) for the console, and the **ingest
plane** (`/api/v1/ingest`) for your product. It runs as a Node cluster; one worker owns the
recurring jobs (a BullMQ schedule) and the two SES queue consumers. The two single-page apps are
static builds behind a CDN.

<p align="center">
  <img src="docs/assets/diagrams/request-and-tenancy.svg" alt="A request through CORS, rate limits, authentication, the entitlement gate, role-based access, the service and a tenant-scoped repository" width="100%">
</p>

Every workspace request passes the same chain: CORS allowlist, rate limits, bearer-token
authentication (the user and the workspace are reloaded and must be active), the entitlement
gate for the module, role-based access, and a repository query scoped by `tenant_id`.
[multi-tenancy-and-entitlements.md](docs/architecture/multi-tenancy-and-entitlements.md) and
[rbac.md](docs/architecture/rbac.md) explain the model.

<p align="center">
  <img src="docs/assets/diagrams/events-and-automation.svg" alt="Domain events driving workflows and actions; product events resolving identity, folding into engagement and intent, and surfacing as signals" width="100%">
</p>

Domain events (a lead created, a deal won, a ticket opened) drive each workspace's workflows.
Product events resolve to a person, fold into an engagement profile and an intent score, and
surface as signals and in the timeline
([automation-engine.md](docs/architecture/automation-engine.md),
[product-integration.md](docs/architecture/product-integration.md)).

<p align="center">
  <img src="docs/assets/diagrams/deployment.svg" alt="AWS deployment: CloudFront and S3 for the two apps, an ALB in front of ECS Fargate API tasks, RDS Postgres, ElastiCache Redis, S3 for files, SES with SNS and SQS, Secrets Manager and KMS" width="100%">
</p>

[HLD.md](docs/architecture/HLD.md) and [LLD.md](docs/architecture/LLD.md) go deeper;
[data-model.md](docs/architecture/data-model.md) lists every table.

## 🧰 Tech stack

| Layer | Choice |
| --- | --- |
| API | Node.js 22, Express 5, TypeScript strict, Kysely on Postgres, zod validation, Node cluster |
| Jobs | BullMQ on Redis (in-process interval fallback without Redis), SQS long-poll consumers |
| Data | PostgreSQL 16, Redis 7, S3 (or local disk) for files |
| Schema | `schema.prisma` for types only (Prisma never touches a database), SQL migrations with a checksummed runner |
| Apps | React 19, Vite, TanStack Query, Zustand, Tailwind, Radix UI |
| Providers | Amazon SES, WhatsApp Cloud API, Twilio, Exotel, Google Calendar, Razorpay, Stripe, OpenAI, Anthropic, Gemini |
| Infra | Docker Compose, Floci (local AWS emulator), Terraform: ECS Fargate, ALB, CloudFront, RDS, ElastiCache, SES, SNS, SQS, KMS, Secrets Manager, WAF |
| Quality | Vitest, Supertest, Playwright with axe, ESLint, Prettier, tflint, checkov, gitleaks |

## 📋 Prerequisites

- Docker with Compose v2
- Node.js 22 and pnpm 9 (`corepack enable`)
- For AWS: an AWS account, Terraform 1.6+ (or Docker, the Makefile falls back to the
  container), and a domain you can add DNS records to

## 🚀 Quickstart

```bash
git clone https://github.com/euron-sde-team/euron-open-crm.git
cd euron-open-crm
pnpm install
make up      # Postgres, Redis, the AWS emulator, migrations, the API and both apps
make demo    # two fictional workspaces full of data, and an operator
```

| | URL | Sign in as |
| --- | --- | --- |
| Workspace app | http://localhost:3570 | `maya@northwind.example.com` (Northwind Academy, Enterprise) or `arjun@acme.example.com` (Acme Robotics, Growth) |
| Operator console | http://localhost:3580 | `root@example.com` |
| API | http://localhost:5066/api/health | |
| Mail | http://localhost:8086 | every email the stack sends |

Every demo account uses `CRM_DEMO_PASSWORD` from `deploy/compose/.env` (generated by
`make env`, which `make up` runs). `make down` stops everything and deletes the volumes.
[quickstart-local.md](docs/guides/quickstart-local.md) covers running the apps outside Docker.

## 🧭 Explore the repository

```
apps/
  api/          Express API: tenant, operator and ingest planes, jobs, seed
    src/routes/index.ts       the gating map: every module route in one place
    src/services/             business rules (engine, AI, channels, billing, ingest)
    src/repositories/         Kysely queries, all tenant-scoped
    prisma/schema.prisma      the schema, used to generate types
    tests/                    unit, pg-mem and HTTP tests against a seeded database
  web/          the workspace app (React)
  console/      the operator console (React)
packages/
  sdk/          @open-crm/sdk, the server SDK for integrating a product
db/             SQL migrations and the runner
deploy/compose/ Docker Compose: local, with the AWS emulator, or against real AWS
infra/          Dockerfiles and Terraform (modules and three environments)
e2e/            Playwright tests, including axe accessibility checks
docs/           architecture, ADRs, guides, the Claude Code integration skill
```

## 🔌 API

- **Tenant plane** `/api/v1/*` and **operator plane** `/api/v1/operator/*`: JSON over HTTPS,
  bearer tokens from `/auth/login`, a `{ success, data, message, statusCode }` envelope. The
  route files under [`apps/api/src/routes`](apps/api/src/routes) are the reference, with the
  gating map in [`routes/index.ts`](apps/api/src/routes/index.ts).
- **Ingest plane** `/api/v1/ingest/*`: for your product, with API keys. The deployment serves
  its own OpenAPI document at `/api/v1/ingest/openapi.json`;
  [integrate-your-product.md](docs/guides/integrate-your-product.md) walks through leads,
  identify, events, the catalogue, the tracker and webhooks.

```bash
curl -X POST http://localhost:5066/api/v1/ingest/events \
  -H "Authorization: Bearer crm_sk_YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"event":"pricing.viewed","identity":{"email":"sneha@example.com"}}'
```

## ⚙️ Configuration

Every setting is an environment variable read in one file,
[`apps/api/src/config/index.ts`](apps/api/src/config/index.ts), and documented in
[configuration.md](docs/guides/configuration.md). In production the API refuses to start with
the development `JWT_SECRET` or `CREDENTIALS_ENCRYPTION_KEY`, with short ones, or without
`CORS_ORIGINS`. Connecting real providers, one variable group at a time, is in
[connect-providers.md](docs/guides/connect-providers.md).

## ☁️ Deploy to AWS

```bash
cp infra/terraform/envs/aws-prod/terraform.tfvars.example infra/terraform/envs/aws-prod/terraform.tfvars
make aws-plan ENV=aws-prod
make aws-deploy ENV=aws-prod                       # images, migrations, services, both apps
make aws-operator ENV=aws-prod EMAIL=you@example.com   # the first operator
```

The Terraform builds a VPC, RDS Postgres, ElastiCache Redis, ECS Fargate API tasks behind an
ALB, CloudFront and S3 for both apps, a private files bucket, SES with event and inbound
queues, KMS keys, Secrets Manager entries, a WAF and alarms. [deploy-aws.md](docs/guides/deploy-aws.md)
has the full walk-through and [operations.md](docs/guides/operations.md) the day-two tasks.

## 🔐 Security model

- **Isolation.** Shared schema, `tenant_id` on every tenant table and query, 404 for other
  workspaces' records, tested against two seeded workspaces.
- **Access.** Entitlement gate then role-based access on every module route; per-user
  overrides only by admins and only with real module keys; operator and tenant tokens are
  separate types.
- **Credentials.** Tenant provider credentials, integration keys and webhook secrets are
  encrypted at rest and never returned; API keys are stored as hashes; publishable keys only
  work from allowed origins.
- **Inbound.** WhatsApp, Razorpay and Stripe webhooks are verified over the raw body with
  constant-time comparison; production refuses unsigned WhatsApp webhooks.
- **Edges.** CORS allowlist, rate limits on sign-in, booking, ingest and AI, a configured proxy
  count, SSRF guards on outbound webhooks and catalogue feeds, signed expiring file links.

Known gaps are listed honestly in [security.md](docs/architecture/security.md#known-gaps) and the
threats in [threat-model.md](docs/architecture/threat-model.md). Report vulnerabilities
privately as described in [SECURITY.md](SECURITY.md).

## 🧪 Testing

```bash
pnpm test              # unit and pg-mem tests, no database
make test-integration  # the API over HTTP against a freshly migrated and seeded Postgres
make e2e               # Playwright against the running stack, with axe in both themes
make tf-validate tf-lint tf-security
make sanitize          # no credentials, account ids, real emails or IPs in the repo
```

More than 900 API tests cover every module's HTTP behaviour, workspace isolation, entitlements,
webhooks, billing and the hardening rules; [testing.md](docs/guides/testing.md) explains the
layers.

## 📖 Documentation

| Architecture | Guides |
| --- | --- |
| [HLD](docs/architecture/HLD.md), [LLD](docs/architecture/LLD.md), [data model](docs/architecture/data-model.md) | [Quickstart](docs/guides/quickstart-local.md), [walkthrough](docs/guides/walkthrough.md) |
| [Multi-tenancy and entitlements](docs/architecture/multi-tenancy-and-entitlements.md), [RBAC](docs/architecture/rbac.md) | [Configuration](docs/guides/configuration.md), [connect providers](docs/guides/connect-providers.md) |
| [Automation engine](docs/architecture/automation-engine.md), [AI](docs/architecture/ai.md) | [Integrate your product](docs/guides/integrate-your-product.md), [Exotel telephony](docs/guides/telephony-exotel.md) |
| [Product integration](docs/architecture/product-integration.md), [channels](docs/architecture/channels.md) | [Deploy to AWS](docs/guides/deploy-aws.md), [operations](docs/guides/operations.md) |
| [Platform billing](docs/architecture/platform-billing.md) | [Testing](docs/guides/testing.md), [troubleshooting](docs/guides/troubleshooting.md) |
| [Security](docs/architecture/security.md), [threat model](docs/architecture/threat-model.md), [ADRs](docs/architecture/adr/README.md) | [Claude Code integration skill](docs/integrations/claude-skill/README.md) |

## 🗺️ Roadmap

- Revocable server-side sessions with refresh rotation, and two-factor sign-in.
- A transactional outbox so workflow actions and audit writes are retried, not best-effort.
- Journeys: multi-step nurture sequences across channels.
- AI voice agents that place and take calls.
- Semantic (embedding) search for the knowledge base, which unlocks the support and knowledge
  agents.
- KMS envelope encryption with key rotation for tenant credentials.
- A shared UI package for the two apps.

## ❓ FAQ

<details>
<summary><b>Do I need any provider account to try it?</b></summary>

No. `make up && make demo` runs WhatsApp, Twilio, Exotel, Razorpay, Stripe and platform billing
in their simulated modes, email through the local AWS emulator into Mailpit, and AI on the
offline engine.
</details>

<details>
<summary><b>Can I run it for a single company?</b></summary>

Yes. Create one tenant in the operator console on a plan with every module, and use only the
workspace app. Nothing requires more than one workspace.
</details>

<details>
<summary><b>How do I connect my own product?</b></summary>

Add a connected product under Integrations, take its secret key for your server and its
publishable key for your pages, then send identify and event calls through the SDK, the tracker
or plain HTTP ([integrate-your-product.md](docs/guides/integrate-your-product.md)). There is also
a Claude Code skill that wires it up for you ([claude-skill](docs/integrations/claude-skill/README.md)).
</details>

<details>
<summary><b>Who pays for WhatsApp, SMS, email and calls?</b></summary>

Each workspace connects its own WhatsApp, Twilio or Exotel, Razorpay or Stripe accounts and pays
those providers directly. The operator can also configure platform defaults that workspaces use
until they connect their own.
</details>

<details>
<summary><b>What happens when a workspace stops paying?</b></summary>

The billing sweep moves the subscription to past due with a grace period, then removes the
plan's entitlements; reinstating the subscription restores them. Operator overrides survive
both ([platform-billing.md](docs/architecture/platform-billing.md)).
</details>

## 🤝 Contributing, security and license

- [CONTRIBUTING.md](CONTRIBUTING.md): how to set up, the checks a pull request must pass, and the
  coding conventions.
- [SECURITY.md](SECURITY.md): how to report a vulnerability privately.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- [MIT License](LICENSE).
