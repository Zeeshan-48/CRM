# Walkthrough

A tour of Euron Open CRM with the demo data, as a workspace admin, a sales agent, a
second tenant on a smaller plan, and the operator. Everything named here is created by
[`apps/api/scripts/seed.ts`](../../apps/api/scripts/seed.ts) and
[`apps/api/scripts/seed-product-integration.ts`](../../apps/api/scripts/seed-product-integration.ts).
Paths are relative to the repository root.

Every provider runs simulated in the demo: no email, WhatsApp message, call or payment
leaves the machine ([ADR 0006](../architecture/adr/0006-simulated-providers-for-local-and-tests.md)).

## Before you start

Seed a migrated database:

```bash
pnpm db:migrate
pnpm demo:seed            # or --force to wipe and reseed
```

Addresses (the defaults of `CRM_APP_URL`, `OPERATOR_APP_URL` and `PORT` in
[`apps/api/src/config/index.ts`](../../apps/api/src/config/index.ts)):

| What | Where |
| --- | --- |
| Workspace app (`apps/web`) | `http://localhost:3570` |
| Operator console (`apps/console`) | `http://localhost:3580` |
| API | `http://localhost:5066/api/v1`, health at `/api/health` |

## Who is in the demo

| Account | Password | Role | Workspace |
| --- | --- | --- | --- |
| `maya@northwind.example.com` | `admin123` | ADMIN | Northwind Academy (ENTERPRISE) |
| `vikram@northwind.example.com` | `manager123` | MANAGER | Northwind Academy |
| `asha@`, `neha@northwind.example.com` | `agent123` | SALES_AGENT | Northwind Academy |
| `ravi@northwind.example.com` | `agent123` | SUPPORT_AGENT | Northwind Academy |
| `meera@northwind.example.com` | `agent123` | MARKETING_AGENT | Northwind Academy |
| `anil@northwind.example.com` | `agent123` | FINANCE | Northwind Academy |
| `arjun@acme.example.com` | `admin123` | ADMIN | Acme Robotics (GROWTH) |
| `rahul@`, `karan@`, `priya@`, `sara@`, `dev@`, `nina@acme.example.com` | `manager123` for Rahul, `agent123` for the rest | MANAGER, SALES_AGENT (Karan, Priya), SUPPORT_AGENT, MARKETING_AGENT, FINANCE | Acme Robotics |
| `root@example.com` | `operator123` | SUPERADMIN | Operator console |

When `DEMO_PASSWORD` is set at seed time, every account uses it instead.

Each workspace gets the same shape of data: 12 leads with notes, owners and tags, 4
accounts with one active contract, 8 contacts, 10 deals across the default pipeline
(Qualified, Demo Scheduled, Demo Completed, Proposal Sent, Negotiation, Won, Lost), 26
activities, WhatsApp and email conversations, 3 campaigns, 6 tickets under a "Standard"
SLA (4 hours first response, 24 hours resolution), 6 knowledge base articles, 3 workflows,
3 simulated call records, paid and overdue invoices, 2 meetings, a booking link, a webhook
subscription, an API key and one connected product with a catalog and product activity.
The two workspaces differ in their plan, their brand colour and their catalog.

## 1. The admin's workspace

Sign in to the workspace app as Maya. The left rail is built from
[`apps/web/src/components/layout/nav.ts`](../../apps/web/src/components/layout/nav.ts) and
shows only what Northwind Academy's plan and Maya's role allow: on ENTERPRISE with the
ADMIN role, that is everything. The accent colour is Northwind's `brand_color`
(`#0a66c2`).

- **Dashboard** and **My Work** (reminders and tasks).
- **Leads**: twelve leads from sources such as Website Form, WhatsApp, Google Ads and
  Referral, each with a stored score and grade. Open one for its Overview, Timeline,
  Product, Deals, Calls and Documents tabs. Some leads carry a document record.
- **Pipeline**: the deal board with the seven stages, one deal already Won and one Lost.
- **Accounts** and **Contacts**: four companies, eight people, one annual contract.
- **Calendar**: a scheduled online demo and an onsite review.

Press Ctrl+K (Cmd+K on a Mac) for the command palette, and use the Copilot button in the
top bar to ask about the workspace. The copilot answers through read-only tools scoped to
this tenant ([../architecture/ai.md](../architecture/ai.md)).

## 2. Products and buyer signals

The seed connects one product per workspace, so the product integration surfaces are
populated ([../architecture/product-integration.md](../architecture/product-integration.md)).

- **Products**: Northwind's catalog is three courses (AI Engineering Bootcamp, Data
  Analytics Professional, Interview Prep Intensive) with prices in minor units, some with a
  strike-through price. The **Offers & coupons** tab has one live coupon, `SAVE20`, and an
  expired one, `EARLYBIRD`, which is never offered to an agent.
- **Signals**: the people showing buying intent inside the product. The seed tells three
  stories: the first two leads by creation date (Rohit Sharma and Sneha Patel) viewed
  pricing repeatedly and abandoned a checkout, so they are HOT; the next three signed up
  and are browsing (WARM); the first two contacts are paying customers.
- Open a HOT lead and pick the **Product** tab: lifecycle stage, intent score with its
  reasons, the abandoned cart and the products viewed.
- **Integrations & API**: the connected product (key `northwind-academy`, environment
  LIVE, catalog mode PUSH), its event definitions, an API key named "Production key", and
  a webhook subscription for `deal.won` pointing at `https://hooks.example.com/crm`.

## 3. Conversations, marketing and service

- **WhatsApp** and **Email** under Conversations: seeded two-way threads. Sending runs
  simulated and is recorded on the conversation.
- **Compose Email**: one "Welcome" template.
- **Campaigns**: three campaigns with cost, revenue and leads generated for ROI.
- **Tickets**: six tickets in different states and priorities with SLA due times;
  **Knowledge Base**: six articles (pricing, refunds, booking a demo, course access,
  certificates, technical requirements). An agent can ask the AI to draft a resolution from
  the knowledge base on a ticket.
- **Workflows**: three rules. "New lead: assign + welcome email + WhatsApp" fires on
  `lead.created`, "Ticket created: notify support" on `ticket.created`, "Deal won: tag
  customer" on `deal.won` ([../architecture/automation-engine.md](../architecture/automation-engine.md)).
  Create a lead by hand and watch its automation runs.

No WhatsApp templates are seeded: a template only exists once Meta approves it, so the
workflow's WhatsApp step has nothing to send until you sync templates from a connected
account.

## 4. Channels, money and administration

- **Email Sending**, **WhatsApp** and **Telephony** under Channels: where an admin or
  manager connects their own SES sending domain, WhatsApp Business account, Twilio or
  Exotel account ([../architecture/channels.md](../architecture/channels.md),
  [connect-providers.md](connect-providers.md)). Nothing is connected in the demo.
- **Finance**: invoices for the won deals (paid through a recorded Razorpay payment) and
  one overdue invoice.
- **Users & Roles**: the seven users, the built-in roles, and one custom role, "Closer"
  (leads, deals, contacts, activities, telephony, copilot) ([../architecture/rbac.md](../architecture/rbac.md)).
- **Billing**: Northwind has no platform subscription (the seed creates none), so the page
  has nothing to pay ([../architecture/platform-billing.md](../architecture/platform-billing.md)).
- **Audit & Compliance**: the audit trail, starting with `tenant.created`. Your own
  sign-in appears there too.
- **Settings**: workspace name, brand colour and preferences.

## 5. The same workspace as a sales agent

Sign out and sign in as `asha@northwind.example.com`. The rail shrinks to what
`SALES_AGENT` grants ([`apps/api/src/constants/modules.const.ts`](../../apps/api/src/constants/modules.const.ts)):
leads, contacts, accounts, pipeline, activities, products and signals, calendar, the
WhatsApp and Email inboxes, the knowledge base, and the agents pages. Channels,
administration, campaigns, tickets, analytics and finance are gone, and the API refuses
them with `403` if called directly.

As `anil@northwind.example.com` (FINANCE), the bell has an unread "Monthly revenue report
is ready" notification.

## 6. A smaller plan: Acme Robotics

Sign in as `arjun@acme.example.com`. The accent is Acme's `#1d4ed8`. Acme is on GROWTH,
which includes every module except `agents`, so **AI Agents** and **Sales Agent** are not
in the rail even for its ADMIN: the entitlement gate runs before RBAC and no role passes it
([../architecture/multi-tenancy-and-entitlements.md](../architecture/multi-tenancy-and-entitlements.md)).

Acme's connected product is "Acme Cloud" (key `acme-cloud`) and its catalog is software:
Team Plan and Business Plan with monthly and yearly prices, and an Extra Storage add-on.
Nothing from Northwind Academy is visible here.

Back on Northwind as Maya, **AI Agents** and **Sales Agent** are present. The sales agent
drafts outreach for an approval queue; its automation is off until an admin enables it
([../architecture/ai.md](../architecture/ai.md)).

## 7. A public booking page

Each workspace has a "30-min Discovery Call" booking link. Northwind's is at
`http://localhost:3570/meet/northwind/discovery-northwind`. Booking a slot there matches the
visitor's email to an existing lead or creates one, and schedules a meeting in Northwind
Academy.

## 8. The operator console

Sign in to the console as `root@example.com`.

- **Tenants**: Northwind Academy and Acme Robotics with their plans, users and leads. Open
  one to see its entitlement rows (one `module.*` row per module in its plan, plus
  `limit.seats`, `limit.leads`, `limit.ai_credits_monthly` and `limit.connected_apps`) and
  override any of them.
- **Plans**: Starter (free: leads, contacts, deals, activities, calendar, copilot, kb; 3
  seats, 500 leads), Growth (4,999 a month; 25 seats; 3 connected products) and Enterprise
  (19,999 a month; 200 seats; 25 connected products). Editing a plan never changes the
  tenants already on it ([ADR 0003](../architecture/adr/0003-entitlements-first.md)).
- **Billing**: MRR and subscription counts. Both demo tenants are unbilled, so it starts
  empty.
- **Operators** and **Audit**: the operator users and every operator action.

Onboard a third tenant from **Tenants**: the console creates it, snapshots the plan, creates
its first admin and default pipeline, and emails the admin (skipped, and noted in the operator
audit log, while SES is not configured). With a billing gateway selected the new tenant stays suspended until its
first payment ([../architecture/platform-billing.md](../architecture/platform-billing.md)).

## 9. Send a product event

The seeded API key is a fixed demo value, `crm_sk_northwinddemo000000000000`. With the API
running:

```bash
curl -X POST http://localhost:5066/api/v1/ingest/events \
  -H "Authorization: Bearer crm_sk_northwinddemo000000000000" \
  -H "Content-Type: application/json" \
  -d '{"event":"pricing.viewed","identity":{"email":"rohit@example.com"}}'
```

The seeded key predates the connected product, so on first use it is bound to an
automatically created "Default product" rather than to `northwind-academy`
([`apps/api/src/middlewares/api-key.middleware.ts`](../../apps/api/src/middlewares/api-key.middleware.ts)).
For a key bound to the seeded product, create one on the connected product under
**Integrations & API**. The full integration guide: [integrate-your-product.md](integrate-your-product.md).
