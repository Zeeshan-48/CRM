# Automation engine

How domain events become workflow runs, audit rows, notifications and outbound webhooks,
and which background jobs carry event-driven work. Everything here runs inside the API
process: there is no separate worker binary, no outbox and no retry queue for workflows.
Paths are relative to the repository root.

The flow is drawn in [events-and-automation.svg](../assets/diagrams/events-and-automation.svg).

## 1. The pieces

| Piece | Code | Does |
| --- | --- | --- |
| Engine | [`services/engine.service.ts`](../../apps/api/src/services/engine.service.ts) | `emit` (run matching workflows, queue webhooks), `audit`, `notify`, round-robin assignment, conversation and message writes |
| Workflow CRUD | [`services/workflows.service.ts`](../../apps/api/src/services/workflows.service.ts), [`routes/workflows.route.ts`](../../apps/api/src/routes/workflows.route.ts) | Create, update, delete, list runs, test-fire |
| Tables | `workflows`, `automation_runs`, `audit_logs`, `notifications` | [data-model.md](data-model.md) |
| Outbound | [`services/webhook-dispatch.service.ts`](../../apps/api/src/services/webhook-dispatch.service.ts) | Queues `webhook_deliveries` for subscribers of the same event name |

Workflow routes sit behind `M("/workflows", "workflows", ...)` in
[`routes/index.ts`](../../apps/api/src/routes/index.ts): the `module.workflows`
entitlement, then RBAC.

## 2. A workflow

A row in `workflows`: `name`, `trigger` (one event name), `actions` (a JSON array of
`{ type, params }`), `active`, `run_count`, `last_run_at`. There are no conditions: a
workflow runs for every occurrence of its trigger in its tenant.

`POST /api/v1/workflows` refuses a trigger outside `WORKFLOW_TRIGGERS`. Action types are not
validated on write; an unknown type is skipped at run time. `GET /api/v1/workflows/catalogue`
returns both lists.

### Triggers

| Trigger | Emitted by |
| --- | --- |
| `lead.created` | [`services/leads.service.ts`](../../apps/api/src/services/leads.service.ts) on create (UI, API, ingest); on import, only when a `lead.created` workflow exists |
| `lead.converted` | `leads.service.ts`, converting a lead |
| `deal.stage_changed` | [`services/deals.service.ts`](../../apps/api/src/services/deals.service.ts), moving a deal |
| `deal.won` | `deals.service.ts`, moving into a won stage |
| `ticket.created` | [`services/tickets.service.ts`](../../apps/api/src/services/tickets.service.ts) |
| `product.event`, `product.high_intent`, `product.checkout_abandoned`, `product.trial_ending`, `product.limit_reached` | [`services/activity-events.service.ts`](../../apps/api/src/services/activity-events.service.ts), for LIVE product events attached to a lead ([product-integration.md](product-integration.md#signals-and-automation)) |
| `lead.stage_changed`, `form.submitted`, `product.intent_changed` | Accepted as triggers, but nothing emits them in this release |

### Actions

| Type | Params | Does |
| --- | --- | --- |
| `ASSIGN_AGENT` | `role` (default `SALES_AGENT`) | Assigns the lead to the active user of that role with the fewest leads; a `DISQUALIFIED` lead is left alone |
| `SEND_WHATSAPP` | `templateKey` (default `welcome`) | Sends the approved template through [`whatsapp-delivery.service.ts`](../../apps/api/src/services/whatsapp-delivery.service.ts) and records the message in the WhatsApp conversation |
| `SEND_EMAIL` | `templateName` (default `Welcome`) | Resolves the tenant's `email_templates` row or a built-in fallback, fills `{name}` and `{company}`, sends through [`mailer.service.ts`](../../apps/api/src/services/mailer.service.ts) as `NOTIFICATION`, records the message |
| `CREATE_TASK` | `title` (with `{name}`), `dueInDays` (default 1) | Inserts an `OPEN` task for the lead's owner, or the actor |
| `ADD_TAG` | `tag` | Adds the tag to the lead or contact |
| `CREATE_TICKET` | `subject` (with `{name}`), `body` | Inserts an `OPEN` ticket |
| `NOTIFY` | `role`, `text` | Notifies every active user, or every active user of that role |

The channels are described in [channels.md](channels.md). With no provider configured,
WhatsApp and email sends are recorded as simulated
([ADR 0006](adr/0006-simulated-providers-for-local-and-tests.md)).

## 3. `emit`, step by step

`engineService.emit(tenantId, userId, event, ctx)`, where `ctx` is
`{ lead?, contact?, deal? }`:

1. Hand the event to `webhookDispatchService.emit`, which queues one delivery per active
   subscription to that event name (fire-and-forget, and a no-op under tests).
2. Load the tenant's active workflows with `trigger = event`.
3. For each, run its actions in order. Each action is in its own `try`: a failure is
   written into the run log as `ERROR: ...` and the next action still runs.
4. Insert an `automation_runs` row (`workflow_id`, `workflow_name`, `event`, `log`) and bump
   the workflow's `run_count` and `last_run_at`.
5. Return the runs.

Where it runs:

- The CRM services (`leads`, `deals`, `tickets`) `await` it in the request, after the
  business write has committed and outside any transaction. A slow action (a provider
  call) adds to that request's latency. An exception outside an action (for example the
  `automation_runs` insert failing) propagates to the request after the write is already
  stored.
- Product events call it from a detached async block after the event is stored, so the
  producer never waits for or sees a workflow failure.
- `POST /api/v1/workflows/:id/run` emits the workflow's trigger against the tenant's most
  recent lead. Other active workflows on the same trigger run too, as they would for a real
  event.

## 4. Audit and notifications

`engineService.audit(tenantId, userId, action, entityType?, entityId?, meta)` inserts an
`audit_logs` row; `engineService.notify` inserts a `notifications` row. Both are
fire-and-forget: never awaited, never inside a business transaction, and a failed write is
only logged as a warning. Services call `audit` for sign-in and sign-out, record changes,
key and webhook management, product actions, catalog syncs and ingest. The tenant reads the
log at `/api/v1/audit` (module `audit`); the operator plane keeps its own
`operator_audit_logs` ([platform-billing.md](platform-billing.md)).

## 5. Event-driven jobs

The jobs run in one cluster worker, the one forked with `RUN_JOBS=true`
([`src/index.ts`](../../apps/api/src/index.ts)). [`jobs/registry.ts`](../../apps/api/src/jobs/registry.ts)
lists them; [`jobs/scheduler.ts`](../../apps/api/src/jobs/scheduler.ts) runs them as BullMQ
job schedulers when Redis is available and falls back to in-process `setInterval` timers
otherwise. Each is an idempotent "find due rows, process them" sweep.

The ones that carry event-driven work:

| Job | Every | Does |
| --- | --- | --- |
| `webhook-dispatch` | 15 s | Releases deliveries stuck in `SENDING` over 5 min, claims up to 25 due deliveries, sends them signed ([product-integration.md](product-integration.md#webhooks)) |
| `engagement-rollup` | 15 min | Recomputes up to 200 engagement profiles older than 6 h, so intent decays for quiet leads |
| `catalog-pull` | 10 min | Refetches up to 10 PULL-mode catalog feeds older than 1 h |
| `sales-agent-runner` | 5 min | Advances the sales agent's enrollments ([ai.md](ai.md)) |
| `task-reminders` | 1 h | Emails owners of open tasks with `remind_daily`, at most once a day |
| `meeting-reminders` | 1 min | Sends due meeting reminders |

The rest (domain verification, reputation recovery, telephony polling, payment polling,
billing) are described in [channels.md](channels.md) and [platform-billing.md](platform-billing.md).

## 6. Known limitations

- **No outbox, no retry for workflows.** A workflow run is not persisted before it
  executes. If the process dies mid-run, or an action fails, nothing replays it; the
  failure is visible only in that run's `log`.
- **Not transactional with the business write.** The write commits first; the workflow
  runs after. A failure in the engine itself can surface as an error on a request whose
  data was already saved.
- **Audit and notification writes are best-effort.** A failed insert loses the row and
  logs a warning.
- **No conditions or ordering between workflows.** Every active workflow on a trigger runs,
  in the order the database returns them.
- **Triggers without an emitter.** `lead.stage_changed`, `form.submitted` and
  `product.intent_changed` can be chosen but never fire.
- **Webhook delivery is durable, workflows are not.** Outbound webhooks go through
  `webhook_deliveries` and the retry ladder; the enqueue itself is fire-and-forget, so a
  failed insert is only logged.
