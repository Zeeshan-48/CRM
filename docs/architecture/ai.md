# AI

What Euron Open CRM uses a language model for, what runs without one, and where each
piece lives. Every AI feature works with no API key: a deterministic offline provider
answers instead. Paths are relative to the repository root.

## 1. The provider seam

[`apps/api/src/services/ai/provider.ts`](../../apps/api/src/services/ai/provider.ts)
exports one `aiProvider`, chosen once at boot:

| Order | Condition | Provider | Default model | Override |
| --- | --- | --- | --- | --- |
| 0 | `NODE_ENV=test` or running under Vitest | Simulated | None | |
| 1 | `GEMINI_API_KEY` set | `GeminiProvider` | `gemini-2.5-flash-lite` | `AI_EMAIL_GEMINI_MODEL` |
| 2 | `OPENAI_API_KEY` set | `OpenAIProvider` | `gpt-4o-mini` | `AI_EMAIL_OPENAI_MODEL` |
| 3 | `ANTHROPIC_API_KEY` set | `AnthropicProvider` | `claude-opus-4-8` | `AI_EMAIL_ANTHROPIC_MODEL` |
| 4 | No key | Simulated | None | |

The first key found wins; there is no per-tenant choice and no fallback from one vendor to
another. The model override variables are read in `provider.ts` and are not listed in
`.env.example`.

The three real providers share one base class (`LlmProvider`). Each method builds a
prompt, asks the model for JSON, parses it, and on any error (missing or invalid key, API
failure, a response of the wrong shape) logs a warning and returns the heuristic answer.
A model outage degrades features; it never breaks them.

The simulated provider calls the pure functions in
[`apps/api/src/services/ai/heuristics.ts`](../../apps/api/src/services/ai/heuristics.ts):
keyword and weight rules, fixed templates, no network. Its answers carry
`generatedBy: "AI (heuristic)"`.

| Method | Used by | Model-backed when keyed |
| --- | --- | --- |
| `writeEmail` | Email composer drafts, with built-in and per-workspace draft types ([`email.service.ts`](../../apps/api/src/services/email.service.ts)) | Yes |
| `copilot`, `planCopilotTools`, `answerFromTools` | Copilot (section 4) | Yes |
| `coach` | Deal coaching ([`deals.service.ts`](../../apps/api/src/services/deals.service.ts)) | Yes |
| `sentiment` | Refines message sentiment in the background ([`engine.service.ts`](../../apps/api/src/services/engine.service.ts)) | Yes |
| `summarize` | Call summaries ([channels.md](channels.md#recordings-and-call-intelligence)) | Yes |
| `composeOutreach` | Sales agent drafts (section 5) | Yes |
| `assessLead`, `assessDeal` | Lead and deal insight panels | Yes |

`llmLimiter` caps `POST /api/v1/copilot/ask` and `POST /api/v1/agents/:agent/run` at 20
requests per minute per user
([`apps/api/src/middlewares/rate-limit.middleware.ts`](../../apps/api/src/middlewares/rate-limit.middleware.ts)).

## 2. Scores stored at write time

Scores are columns, written when their inputs change, so lists sort and filter on them
without calling anything. They are always computed by the heuristics, with or without a
model key.

### Lead score

[`apps/api/src/services/scoring.service.ts`](../../apps/api/src/services/scoring.service.ts)
writes `leads.score_total`, `score_grade`, `score_breakdown` and `scored_at`. It is
recomputed in the background after lead edits, activities, messages, calls and product
events.

- `scoreLead` in `heuristics.ts` derives four dimensions from the lead's source, tags,
  notes, budget flag, activities (demos and meetings count most), message text (positive
  and negative keywords) and recency: interest, intent, engagement and risk.
- CRM score: `interest × 0.3 + intent × 0.4 + engagement × 0.3 − risk × 0.15`, clamped to
  0 to 100.
- Product intent: when the lead has activity in a connected product, the best intent
  score across all connected products. The total is the larger of the two
  (`blendLeadScore` in [`apps/api/src/services/ai/intent.ts`](../../apps/api/src/services/ai/intent.ts)).
  A lookup failure counts as "no product data", never as zero.
- Grade: `HOT` at 75 or more, `WARM` at 50 or more, else `COLD`.

### Product intent

[`apps/api/src/services/ai/intent.ts`](../../apps/api/src/services/ai/intent.ts) is pure
(no I/O, `now` injectable). Each event contributes its definition's `intent_weight`
(−100 to 100) decayed with a 14 day half-life over a 30 day window; an unresolved abandoned
checkout adds 25. The sum is mapped onto 0 to 100 with diminishing returns, banded `HOT`
from 70 and `WARM` from 40, and returned with plain-English reasons. The
`engagement-rollup` job recomputes it every 15 minutes because intent decays with time,
not only with new events. Details: [product-integration.md](product-integration.md).

### Deal win probability and health

`dealHealth` in `heuristics.ts`, stored by `recomputeStored` in
[`apps/api/src/services/deals.service.ts`](../../apps/api/src/services/deals.service.ts)
on create, update, stage moves, win and loss:

- Win probability: 10 plus up to 70 for stage progress through the pipeline, plus up to 16
  for activities and 6 for a demo, minus 6 above a value of 500000 and minus 12 after 14
  days of silence. `WON` is 100, `LOST` is 0.
- Health: the win probability minus 10 after 5 quiet days or 25 after 10, labelled
  `Healthy` (66 or more), `At risk` (40 or more) or `Critical`.
- Written to `deals.win_probability`, `health_score`, `health_label`.

## 3. Insights and their cache

The lead and deal insight panels call `assessLead` and `assessDeal` through
`rememberInsight` in
[`apps/api/src/services/ai/insight-cache.ts`](../../apps/api/src/services/ai/insight-cache.ts).

- The cache key is a SHA-1 of the exact payload sent to the model (the record, its recent
  activities and messages), so any change produces a new key and nothing needs
  invalidating. Entries live 12 hours in Redis.
- Only model-generated answers are cached. A heuristic fallback (the model failed) is
  returned but not stored, so a short outage is not pinned for 12 hours.
- Without Redis, or on a Redis error, every request is a live call.

## 4. Copilot

[`apps/api/src/services/copilot.service.ts`](../../apps/api/src/services/copilot.service.ts),
`POST /api/v1/copilot/ask`.

With a real model the copilot is agentic in two hops:

1. **Plan.** The model sees the question, up to six previous turns (sent by the client and
   truncated server-side) and a fixed tool catalogue, and returns tool calls.
2. **Answer.** The server runs the calls and the model writes the answer and a table from
   the results.

The tools are in
[`apps/api/src/services/ai/copilot-tools.ts`](../../apps/api/src/services/ai/copilot-tools.ts):
`queryLeads`, `queryDeals`, `queryTickets`, `queryContacts`, `agentPerformance`,
`aggregate`, `queryProductIntent`, `queryProductCatalog`, `queryOffers`. The boundary:

- Every tool is a parameterised `SELECT`; the model never writes SQL.
- `tenant_id` is injected by the server, never taken from model output.
- Every argument is coerced against a whitelist (enums, numbers, strings).
- Rows are capped at 50 per tool, groups at 50, and a plan at 4 tool calls.
- An unknown tool or a failing tool becomes a note in the results, not an error.

If planning, execution or answering fails, or with the simulated provider, the copilot
falls back to a snapshot path: the repository loads a tenant snapshot
([`apps/api/src/repositories/copilot.repository.ts`](../../apps/api/src/repositories/copilot.repository.ts))
and the provider answers from a filtered slice of it (the heuristic copilot when no model
is configured). Every question is written to the audit log with the tools used.

Known limitation: the copilot is gated by the `copilot` module, and its tools are scoped to
the tenant but not to the asking user's other modules. A role that holds `copilot` but not,
say, `deals` can still ask about deals through it.

## 5. AI agents

[`apps/api/src/services/agents.service.ts`](../../apps/api/src/services/agents.service.ts),
module `agents`.

| Agent | What a run does | Listed in the UI |
| --- | --- | --- |
| `sales` | Drafts outreach for hot leads into an approval queue | Yes |
| `marketing` | Sends the workspace's `followup` WhatsApp template (email as fallback) to leads with a tag | Yes |
| `collections` | Sends reminders for overdue invoices to their contacts | Yes |
| `coach` | Coaching for the top open deal, from the provider's `coach` | Yes |
| `support` | Resolves open tickets whose best knowledge base match scores 2 or more | No |
| `knowledge` | Returns the best knowledge base matches for a question | No |

`support` and `knowledge` are hidden (`HIDDEN_AGENT_KEYS`) until their retrieval moves from
keyword matching to semantic search. They are still runnable through
`POST /api/v1/agents/:agent/run`.

### Sales agent

Manual run: up to 100 hot leads (5 by default), minus anyone contacted or holding a pending
draft in the last 7 days. For each, the provider composes a WhatsApp or email message
(WhatsApp first, email when there is no phone) from the lead's facts: score, notes,
company and title, the open deal and its stage, the latest activity and message. The result is an
`agent_outreach` row with status `DRAFT` and a reason.

The approval queue is the human in the loop: a draft is never delivered until a user
approves it (`POST /api/v1/agents/outreach/:id/approve`, optionally with edited copy, or
`approve-all`). Approval delivers on the preferred channel, falls back to the other, marks
the row `SENT` with the message id, and opens a follow-up task due in 24 hours. A lead
whose draft was rejected is never enrolled by the automation below.

Automation is per tenant in `agent_settings`, and every default is the safe one:

| Setting | Default | Range |
| --- | --- | --- |
| `enabled` | `false` | |
| `auto_send` | `false` (drafts wait for approval) | |
| `score_threshold` | 65 | 0 to 100 |
| `daily_cap` | 20 drafts per day | 1 to 500 |
| `channels` | WhatsApp, then email | `WHATSAPP`, `EMAIL` |
| cadence | intro now, follow-up after 2 days, final after 4 more | |
| `escalate_to_call` | `false` | Adds a step that creates a call task for a human |

The `sales-agent-runner` job (every 5 minutes,
[`apps/api/src/jobs/sales-agent-runner.job.ts`](../../apps/api/src/jobs/sales-agent-runner.job.ts))
handles tenants with automation enabled, only inside the workspace's working hours:

1. Enrols leads at or above the threshold that were active in the last 14 days, are not
   already enrolled and were never rejected, within the remaining daily cap
   (`agent_enrollments`).
2. Advances each due enrolment one touch: drafts the next message with an angle that
   differs per touch, auto-sends it only if `auto_send` is on, and schedules the next
   touch. A converted lead stops the sequence. When the cadence runs out, a human
   follow-up task is created.
3. An inbound reply from an enrolled lead marks it replied, pauses its sequence and drafts
   a contextual response for review ([`inbound.service.ts`](../../apps/api/src/services/inbound.service.ts)).

## 6. Knowledge base and ticket AI-resolve

The knowledge base search is lexical. `ragSearch` in `heuristics.ts` splits the query into
words of three or more letters and scores each published article: 3 for a word in the
title, 1 for a word only in the body or tags. It returns the top matches with a snippet
around the first hit ([`apps/api/src/services/kb.service.ts`](../../apps/api/src/services/kb.service.ts)).
There are no embeddings and no model in this path, with or without a key.

Ticket AI-resolve (`aiResolve` in
[`apps/api/src/services/tickets.service.ts`](../../apps/api/src/services/tickets.service.ts))
searches published articles with the ticket's subject and body. When the top match scores
2 or more, the snippet is added as an AI reply (`is_ai = true`), the ticket is set to
`RESOLVED` with `resolved_by = "ai"`, and the action is audited. Below that, it returns the
best match as a suggestion and changes nothing.

## 7. Call intelligence

Transcription and summaries of Exotel call recordings: OpenAI `whisper-1` or Gemini, then
`aiProvider.summarize`, then a heuristic sentiment. Twilio calls are not transcribed.
Details: [channels.md](channels.md#recordings-and-call-intelligence).

## 8. AI credits

Plans carry `ai_credits_monthly`, snapshotted into the `limit.ai_credits_monthly`
entitlement ([`apps/api/src/services/operator/plan-snapshot.ts`](../../apps/api/src/services/operator/plan-snapshot.ts),
[multi-tenancy-and-entitlements.md](multi-tenancy-and-entitlements.md)). Known limitation:
nothing at runtime reads or consumes it. AI usage is not metered per tenant; the only
bound is the per-user `llmLimiter` on copilot and agent runs.

## Roadmap

Not in this release:

- AI voice agent calls (an AI placing or answering phone calls) and AI-calling providers.
  The `voice_calls` table still has columns for them, and a cadence `CALL` step creates a
  task for a human instead.
- Journeys (multi-step drip sequences beyond the sales agent's cadence).
- Course and learning management (LMS) features.
- The simulated voice call page.
- Semantic (embedding) search for the knowledge base, which would let the `support` and
  `knowledge` agents be listed again.
