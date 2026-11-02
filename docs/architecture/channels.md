# Channels

How Euron Open CRM sends and receives email, WhatsApp messages and phone calls, and how
the inbox and campaigns sit on top of them. Every channel has a simulated mode, so the
whole product runs with no provider account ([ADR 0006](adr/0006-simulated-providers-for-local-and-tests.md)).
Turning each one on for real: [../guides/connect-providers.md](../guides/connect-providers.md).
Paths are relative to the repository root.

| Channel | Provider | Platform default tier | Tenant brings its own | Inbound |
| --- | --- | --- | --- | --- |
| Email | Amazon SES | `AWS_SES_FROM_EMAIL` sender | A verified sending domain and sender identities | SES receipt rule, SNS, SQS |
| WhatsApp | Meta Cloud API | `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_API_KEY` | Their own WABA and number through Embedded Signup | Meta webhook |
| Telephony | Twilio | `TWILIO_*` account | Their own Twilio account | None (status is polled) |
| Telephony | Exotel | None | Their own Exotel account (required) | Exotel call flow webhooks |

Channel setup pages (Email Sending, WhatsApp, Telephony) are gated by the `channels`
governance capability; sending is gated by the `email`, `whatsapp` and `voice` modules
([`apps/api/src/routes/index.ts`](../../apps/api/src/routes/index.ts),
[rbac.md](rbac.md)).

## 1. The inbox

Every message on every channel is a row in `messages`, grouped into `conversations` by
channel and person ([data-model.md](data-model.md)).

| Step | Code | Detail |
| --- | --- | --- |
| Outbound | `engineService.sendMessage` in [`apps/api/src/services/engine.service.ts`](../../apps/api/src/services/engine.service.ts) | Records the message with `simulated`, the provider's `external_id` and a delivery `status` |
| Inbound | [`apps/api/src/services/inbound.service.ts`](../../apps/api/src/services/inbound.service.ts) | Channel-agnostic: dedups on the provider message id, matches the sender to a lead or contact (email by address, WhatsApp by normalised phone), creates a lead when nobody matches (source `Email` or `Whatsapp`), records the message |
| Reply from the inbox | [`apps/api/src/services/inbox.service.ts`](../../apps/api/src/services/inbox.service.ts) | `EMAIL` threads go out through the mailer, `WHATSAPP` threads as free text through the Meta client. Other channel values in the enum (`SMS`, `TELEGRAM`, `CHAT`, `FACEBOOK`, `INSTAGRAM`, `VOICE`) have no transport and are recorded as simulated |
| Delivery status | `inboundService.applyStatus` | WhatsApp `sent`, `delivered`, `read`, `failed` applied to the outbound message by its wamid |
| Test data | `POST /api/v1/inbox/simulate-inbound` | Records an inbound message without a provider |

An inbound message from a lead in an active sales sequence also pauses the sequence and
drafts a reply for review ([ai.md](ai.md)).

## 2. Email (SES)

### Sending path

All email goes through `mailerService.send`
([`apps/api/src/services/mailer.service.ts`](../../apps/api/src/services/mailer.service.ts)).
A send has a category: `TRANSACTIONAL`, `NOTIFICATION` or `MARKETING`.

1. If the caller sent only text, it is wrapped in the tenant's branded HTML shell
   ([`apps/api/src/utils/email-html.ts`](../../apps/api/src/utils/email-html.ts)) so SES
   can track opens and clicks.
2. The resolver
   ([`apps/api/src/services/email-resolver.service.ts`](../../apps/api/src/services/email-resolver.service.ts))
   picks the tenant's default sender identity for the category, but only when its sending
   domain is `VERIFIED`. The answer is cached in Redis for 60 seconds and invalidated on
   every domain or identity change.
3. **Custom domain** (resolver found one): reputation gate, suppression check, rate limit,
   then SES with the tenant's configuration set and three message tags (`tenantId`,
   `messageId`, `category`). On an SES error it falls back to the platform sender.
4. **Platform sender** (no verified domain): sends from `AWS_SES_FROM_EMAIL` with the
   tenant's configuration set, so events still flow. With `AWS_SES_FROM_EMAIL` blank the
   send is simulated.
5. Each real send is a row in `email_messages` (`QUEUED`, then `SENT` with the SES message
   id) and counts toward reputation.

`MARKETING` sends carry RFC 8058 `List-Unsubscribe` and `List-Unsubscribe-Post` headers.

Known limitation: the reputation gate, the suppression list and the per-tenant rate limit
are applied only on the custom-domain path. Mail sent through the platform sender
(`sendLegacy`) skips all three.

Which callers use which category:

| Caller | Category |
| --- | --- |
| Compose email to a lead or contact ([`email.service.ts`](../../apps/api/src/services/email.service.ts)) | `NOTIFICATION` |
| Inbox reply | `NOTIFICATION` |
| Campaign send | `MARKETING` |

### Sending domains

[`apps/api/src/services/email-domains.service.ts`](../../apps/api/src/services/email-domains.service.ts),
[`apps/api/src/utils/email-dns.ts`](../../apps/api/src/utils/email-dns.ts).

- One active sending domain per workspace. Onboarding creates an SES configuration set
  (`email-tenant-<tenantId>`), an email identity with DKIM, and a custom MAIL FROM of
  `bounce.<domain>`, and stores the domain as `PENDING`.
- The DNS records to publish: three DKIM CNAMEs, the MAIL FROM MX
  (`feedback-smtp.<region>.amazonses.com`) and SPF TXT, a sending SPF TXT, and a starter
  DMARC record (`p=none`). An apex domain is accepted; the UI warns that a subdomain is
  better.
- `VERIFIED` when SES reports both DKIM and MAIL FROM as `SUCCESS`. `FAILED` only when one
  of them fails and the domain is more than 24 hours old, so slow DNS does not fail it.
- The `verify-domains` job (every minute) re-checks every `PENDING` domain; an admin can
  also press Check. The `health-sweep` job (daily) re-checks `VERIFIED` domains, records
  DKIM, MAIL FROM, SPF and DMARC presence in `email_domain_health_checks`, and fails a
  domain that has been broken across two checks more than 24 hours apart, which sends mail
  back to the platform sender. Both jobs do nothing while SES is simulated (`AWS_SES_FROM_EMAIL` unset)
  ([`apps/api/src/jobs/verify-domains.job.ts`](../../apps/api/src/jobs/verify-domains.job.ts),
  [`apps/api/src/jobs/health-sweep.job.ts`](../../apps/api/src/jobs/health-sweep.job.ts)).
- Without SES keys, onboarding returns deterministic fake DKIM tokens so the DNS table
  renders, and the domain stays `PENDING`
  ([`apps/api/src/services/email-ses.client.ts`](../../apps/api/src/services/email-ses.client.ts)).

### Sender identities

[`apps/api/src/services/email-identities.service.ts`](../../apps/api/src/services/email-identities.service.ts).
An identity is an address on the sending domain with a display name and an optional
reply-to. Each identity can be the default for any of the three categories; setting a
default clears it from the other identities in the same transaction. The resolver uses the
default for the category being sent.

### Suppressions and unsubscribe

| Reason | Added by | Scope |
| --- | --- | --- |
| `HARD_BOUNCE` | SES permanent bounce event | Every category |
| `COMPLAINT` | SES complaint event | Every category |
| `MANUAL_UNSUBSCRIBE` | The public unsubscribe link | `MARKETING` only |
| `ADMIN_BLOCK` | An admin under Email Sending | One category or every category |

A suppressed recipient is recorded as `SUPPRESSED` in `email_messages` and nothing is sent
([`apps/api/src/services/email-suppressions.service.ts`](../../apps/api/src/services/email-suppressions.service.ts)).

The unsubscribe link is `{APP_PUBLIC_URL}/api/v1/unsubscribe?token=...`. The token is the
tenant id and the recipient, HMAC-SHA256 signed with `JWT_SECRET`, checked in constant
time ([`apps/api/src/utils/unsubscribe.ts`](../../apps/api/src/utils/unsubscribe.ts)). `GET`
shows a confirmation page, `POST` is the one-click form post
([`apps/api/src/controllers/unsubscribe.controller.ts`](../../apps/api/src/controllers/unsubscribe.controller.ts)).
The token has no expiry.

### Reputation

[`apps/api/src/services/reputation.service.ts`](../../apps/api/src/services/reputation.service.ts).
Sends, permanent bounces and complaints are counted per tenant in Redis sorted sets over a
rolling 14 day window. Below 100 sends nothing changes. Above that, the status is the worst
tier whose threshold is crossed:

| Status | Bounce rate | Complaint rate |
| --- | --- | --- |
| `WARNING` | 3% | 0.05% |
| `THROTTLED` | 5% | 0.1% |
| `PAUSED` | 8% | 0.3% |

Each status scales the tenant's send rate per category (`categoryMultiplier` in the
mailer):

| Status | `TRANSACTIONAL` | `NOTIFICATION` | `MARKETING` |
| --- | --- | --- | --- |
| `ACTIVE` | 1 | 1 | 1 |
| `WARNING` | 1 | 1 | 0.5 |
| `THROTTLED` | 1 | 0.5 | 0.1 |
| `PAUSED` | 1 | 0.5 | 0 (blocked) |

- Degrading happens immediately, on the bounce or complaint that crosses a threshold.
- The `reputation-recovery` job (every 10 minutes) steps a `WARNING` or `THROTTLED` tenant
  one level back toward `ACTIVE` once 48 hours have passed since the last change and the
  rates have cleared. `PAUSED` is never recovered automatically.
- Every transition is stored in `email_reputation_events` with the rates at that moment,
  and `tenants.email_sending_status` holds the current value.
- Without Redis no rates exist and the status never changes.

### Throttle

[`apps/api/src/services/rate-limit.service.ts`](../../apps/api/src/services/rate-limit.service.ts)
`allowEmailSend` counts sends per second in Redis:

| Limit | Source |
| --- | --- |
| Per tenant | `tenants.config.emailTps`, else `EMAIL_DEFAULT_TENANT_TPS` (5), times the reputation multiplier, at least 1 |
| Whole deployment | `EMAIL_ACCOUNT_TPS`, else `EMAIL_MAX_SEND_PER_SECOND` (14) |

A send over the limit is recorded as `FAILED` and not retried. Without Redis the throttle
allows everything.

### Delivery events

`ses-events.consumer`
([`apps/api/src/jobs/ses-events.consumer.ts`](../../apps/api/src/jobs/ses-events.consumer.ts))
long-polls `SES_EVENTS_QUEUE_URL` and hands each message to
[`apps/api/src/services/email-events.service.ts`](../../apps/api/src/services/email-events.service.ts),
which unwraps an SNS envelope if present and maps the event back to its `email_messages`
row through the `messageId` tag:

| SES event | Effect |
| --- | --- |
| `Delivery`, `Open`, `Click`, `Reject` | Timestamp or status on the row |
| `Bounce` (permanent) | `BOUNCED`, recipient suppressed, reputation updated |
| `Bounce` (transient) | Nothing (SES retries) |
| `Complaint` | `COMPLAINED`, recipient suppressed, reputation updated |

A message is deleted from the queue only after it is processed; failures are left for the
queue's redrive policy. The configuration set publishes to `SES_EVENTS_SNS_TOPIC_ARN` when
it is set. [`apps/api/scripts/ses-infra-setup.ts`](../../apps/api/scripts/ses-infra-setup.ts)
creates the topic, the queue and its dead-letter queue and prints the two values. On AWS the
Terraform email module ([`infra/terraform/modules/email`](../../infra/terraform/modules/email))
creates the same kind of resources (configuration set, SNS topic, SQS queue with a dead-letter
queue, inbound receipt rule).

### Inbound mail

`ses-inbound.consumer`
([`apps/api/src/jobs/ses-inbound.consumer.ts`](../../apps/api/src/jobs/ses-inbound.consumer.ts))
long-polls `SES_INBOUND_QUEUE_URL` (region `SES_INBOUND_REGION`).
[`apps/api/src/services/email-inbound.service.ts`](../../apps/api/src/services/email-inbound.service.ts)
takes the SES `Received` notification, finds the tenant from the recipient's domain (it
must be a tenant's sending domain), and ingests the message into the inbox. The body is a
best-effort plain-text extraction from the raw MIME (first `text/plain` part,
quoted-printable decoded, 8000 characters at most); it is not a full MIME parser.

Both consumers run on the jobs worker only and stay idle while their queue URL is unset
([`apps/api/src/jobs/index.ts`](../../apps/api/src/jobs/index.ts)).

Credentials: the SES v2 client, the operator email service, both SQS consumers and the setup
script take their options from `sesClientOptions` in
[`apps/api/src/utils/aws.ts`](../../apps/api/src/utils/aws.ts): static `AWS_SES_ACCESS_KEY`
and `AWS_SES_SECRET_KEY` when both are set, otherwise the default AWS credential chain (an ECS
task role), and `AWS_ENDPOINT_URL` when set. SES counts as live when `AWS_SES_FROM_EMAIL` is
set (`sesConfigured`), never under tests.

## 3. WhatsApp (Meta Cloud API)

### Who sends

[`apps/api/src/services/whatsapp-resolver.service.ts`](../../apps/api/src/services/whatsapp-resolver.service.ts):
the tenant's own connection when its `tenant_whatsapp` row is `ACTIVE`, else the platform
default number from `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_API_KEY`, else none. Every
send site (compose, inbox reply, campaigns, broadcasts, workflows, the sales agent) goes
through [`apps/api/src/services/whatsapp-delivery.service.ts`](../../apps/api/src/services/whatsapp-delivery.service.ts),
which reports whether Meta actually accepted the message so it is never recorded as sent
when it was not.

- A `templateKey` send is a template message (cold outreach). If the template was synced
  from Meta, its stored language and variable count shape the payload.
- A free-text send is a session message. Meta delivers it only inside its 24 hour
  customer-service window; the CRM does not check the window itself, it records Meta's
  answer.
- `WHATSAPP_TEST_ALLOWLIST`: when set, a send to a number not on the list is recorded as
  simulated instead of reaching Meta.

### Connecting a tenant's own number

[`apps/api/src/services/whatsapp-config.service.ts`](../../apps/api/src/services/whatsapp-config.service.ts).
Embedded Signup only; there is no manual credential entry. The operator's Meta app
(`META_APP_ID`, `META_APP_SECRET`) brokers the OAuth code exchange; the tenant connects its
own WhatsApp Business Account (WABA) and number. Onboarding:

1. Refuses a WABA already connected to another workspace (`409`).
2. Exchanges the code for the tenant's token.
3. Fetches the number's display phone and verified name.
4. Registers the number for the Cloud API with a six-digit PIN, reusing the stored PIN on
   reconnect (Meta locks a number when a different PIN is used).
5. Subscribes the app to the WABA so webhooks flow.
6. Stores the token and PIN encrypted ([ADR 0005](adr/0005-byo-provider-credentials-encrypted.md));
   `ACTIVE` only if steps 3 and 4 succeeded.

The config endpoint never returns the token, only `access_token_set`. Without `META_APP_ID`
and `META_APP_SECRET` the Connect button is hidden and the platform default tier (or
simulation) is used.

### Templates

`POST /api/v1/whatsapp/templates/sync`
([`apps/api/src/services/whatsapp.service.ts`](../../apps/api/src/services/whatsapp.service.ts))
fetches the WABA's templates from Meta, upserts their language, variable count and Meta id
into `whatsapp_templates`, and deletes Meta-backed rows Meta no longer returns. Templates can
also be created locally. A template send always uses the key as the Meta template name; for
a template that was never synced, the caller's parameters are passed as given.

### Webhooks

Mounted before the JSON parser with a raw-body parser so the signature covers the exact
bytes ([`apps/api/src/app.ts`](../../apps/api/src/app.ts),
[`apps/api/src/routes/wa-webhook.route.ts`](../../apps/api/src/routes/wa-webhook.route.ts),
[`apps/api/src/controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts)).

| Path | Verify token | Signature secret | Tenant |
| --- | --- | --- | --- |
| `/api/v1/wa/webhooks/whatsapp` (shared, Embedded Signup) | `META_WEBHOOK_VERIFY_TOKEN` | `META_APP_SECRET` | Per entry, from the WABA id |
| `/api/v1/wa/webhooks/:token` (per tenant, older path) | The tenant's `webhook_verify_token`, which is also the URL token | The tenant's stored app secret | The row the URL token matches |

- `X-Hub-Signature-256` is checked as `sha256=` plus the hex HMAC-SHA256 of the raw body, in
  constant time; a mismatch is `401`.
- The handler answers `200` straight away and processes in the background: inbound
  messages are ingested (text, button and interactive replies as text; media as
  `[image]`, `[audio]` and so on), statuses are applied, and a failed status logs Meta's
  error.

When the signing secret is not set (no `META_APP_SECRET` on the shared path, no stored app
secret on the per-tenant path), production (`NODE_ENV=production`) answers
`401 Webhook signing secret not configured`; outside production the payload is processed
unverified with a warning in the log
([`controllers/wa-webhook.controller.ts`](../../apps/api/src/controllers/wa-webhook.controller.ts)).

Known limitations: Embedded Signup does not set a per-tenant verify token, so the
per-tenant path is only useful for rows that have one. Inbound media is not downloaded.

## 4. Telephony

The tenant picks a provider in Telephony settings; one `tenant_telephony` row holds it
([`apps/api/src/services/telephony.service.ts`](../../apps/api/src/services/telephony.service.ts),
[`apps/api/src/services/telephony-resolver.service.ts`](../../apps/api/src/services/telephony-resolver.service.ts)).
Calls are rows in `voice_calls`.

### Twilio click-to-call

- Credentials: the tenant's own `ACTIVE` Twilio row, else the platform default
  `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_DEFAULT_FROM_NUMBER`, else none. A
  tenant with a saved but unvalidated Twilio row is refused rather than silently dialled
  from the platform account.
- `POST /api/v1/telephony/call` rings the agent's phone (their profile's calling number,
  E.164), then bridges to the lead or contact
  ([`apps/api/src/services/twilio.client.ts`](../../apps/api/src/services/twilio.client.ts)).
- No webhook is used: the `calls-poll` job (every 15 seconds) fetches the status, duration
  and error of non-terminal calls
  ([`apps/api/src/jobs/calls-poll.job.ts`](../../apps/api/src/jobs/calls-poll.job.ts)).
- Twilio calls are not recorded or transcribed by the CRM.

### Exotel

Exotel is bring-your-own only (no platform account). It adds inbound routing, a number
pool and recordings. Setup, the call flow and every rule:
[../guides/telephony-exotel.md](../guides/telephony-exotel.md). In short:

- Inbound calls ask the CRM who to ring: the agent who owns the dialled pool number, then
  the lead's owner or last agent, then the least recently called available agent, one per
  attempt so the flow cascades
  ([`apps/api/src/services/telephony-routing.service.ts`](../../apps/api/src/services/telephony-routing.service.ts),
  [`apps/api/src/services/exotel-webhook.service.ts`](../../apps/api/src/services/exotel-webhook.service.ts)).
- Outside the workspace's working hours nobody is rung.
- Outbound click-to-call is allowed only from 09:00 to 21:00 IST, and shows the agent's
  pool number as caller id when they have one.
- Exotel signs nothing; an unguessable per-tenant token in the webhook path is the whole
  authentication.
- The `exotel-sync` job (every 30 seconds) backfills calls whose callbacks never arrived
  and retries recording mirrors for two hours
  ([`apps/api/src/jobs/exotel-sync.job.ts`](../../apps/api/src/jobs/exotel-sync.job.ts)).

### Recordings and call intelligence

[`apps/api/src/services/call-intelligence.service.ts`](../../apps/api/src/services/call-intelligence.service.ts)
runs after a finished Exotel call, fired from the webhooks and retried by `exotel-sync`:

1. Downloads the recording with the tenant's Exotel credentials and stores it as
   `telephony/<tenantId>/<callSid>.mp3` through the storage service (S3 or local disk).
   The play button gets a link that expires in one hour
   (`GET /api/v1/telephony/calls/:id/recording`).
2. Transcribes it with OpenAI `whisper-1` when `OPENAI_API_KEY` is set, else Gemini
   `gemini-2.0-flash` when `GEMINI_API_KEY` is set. No key, or Anthropic only: no
   transcript.
3. With a transcript: a summary from the AI provider ([ai.md](ai.md)) and a heuristic
   sentiment score.
4. Exactly once per call (guarded by `structured_data.intelligence_done`): a `CALL`
   activity on the lead or contact, `last_activity_at` bumped, the lead score recomputed.

A missed inbound call creates a `HIGH` priority callback task due in two hours for the
lead's owner or last agent. Calls an agent makes from a personal phone can be logged by
hand (`POST /api/v1/telephony/calls/manual`) with the same side effects and no recording.

AI voice agent calls (an AI placing or answering calls) are not in this release
([ai.md](ai.md#roadmap)).

## 5. Campaigns

[`apps/api/src/services/campaigns.service.ts`](../../apps/api/src/services/campaigns.service.ts).
A campaign row tracks cost, revenue and leads for ROI. Campaigns whose channel is `EMAIL`
or `WHATSAPP` can also be sent from the CRM, once:

- The audience is the tenant's leads carrying `audience_tag` (all leads when no tag),
  newest first, at most 1000
  ([`apps/api/src/repositories/campaigns.repository.ts`](../../apps/api/src/repositories/campaigns.repository.ts)).
- Email: one `MARKETING` send per lead with an email address, idempotency key
  `campaign_<campaignId>_<leadId>`. `{name}` is replaced by the lead's first name.
- WhatsApp: the campaign's `subject` holds the approved template name and
  `template_params` the values for `{{1}}`, `{{2}}` and so on (each may contain `{name}`).
  The wamid is stored so delivery statuses aggregate per campaign.
- The result counts `sent` (a provider accepted it), `simulated` and `skipped` (no
  address or phone). One failing recipient never stops the rest.

Known limitations: the send runs inside the HTTP request, one recipient at a time, so a
large audience makes a slow request. The "already sent" guard is checked before sending
and `sent_at` written after, so two simultaneous send requests are not prevented.

`POST /api/v1/whatsapp/campaigns` is a simpler WhatsApp broadcast: one template to every
lead with a tag, recorded as a campaign row.
