# Connect real providers

Euron Open CRM starts with every outside provider simulated: email is recorded instead of
sent, WhatsApp and calls get fake ids, payment links are canned, AI answers come from
offline heuristics ([ADR 0006](../architecture/adr/0006-simulated-providers-for-local-and-tests.md)).
This guide turns each one into the real thing. Paths are relative to the repository root.

Variables are read in [`apps/api/src/config/index.ts`](../../apps/api/src/config/index.ts)
and listed in [`apps/api/.env.example`](../../apps/api/.env.example).

## Two tiers

Most channels have two tiers:

| Tier | Who configures it | Where |
| --- | --- | --- |
| Platform default | The operator, once, with environment variables | This guide |
| Bring your own | Each workspace admin, for their own workspace | The tenant app (table below) |

A workspace with an `ACTIVE` connection of its own uses it; otherwise the platform default
is used; with neither, the channel is simulated or refused. Exotel and Google Calendar have
no platform default tier.

Where workspace admins enter their own credentials:

| Provider | Tenant app page | Who can |
| --- | --- | --- |
| SES sending domain and sender identities | Channels, Email Sending | `channels` capability |
| WhatsApp (Embedded Signup) | Channels, WhatsApp | `channels` capability |
| Twilio, Exotel, ExoPhone numbers | Channels, Telephony | `channels` capability |
| Razorpay, Stripe (invoices and payment links) | Finance, payment gateways | `ADMIN` role |
| Google Calendar | Calendar, connect Google (each user for themselves) | Any user with `calendar` |

Every tenant-supplied secret (Twilio and Exotel tokens, the WhatsApp access token and
registration PIN, Razorpay and Stripe secrets, Google refresh tokens, integration
credentials, webhook signing secrets) is encrypted with AES-256-GCM under
`CREDENTIALS_ENCRYPTION_KEY` before it is stored, and no endpoint returns it: config reads
return masked ids and `*_set` flags only
([ADR 0005](../architecture/adr/0005-byo-provider-credentials-encrypted.md)). Production
refuses to start without a `CREDENTIALS_ENCRYPTION_KEY` of 32 characters or more.

## Simulate switches

Under tests (`NODE_ENV=test` or Vitest) every provider below is simulated whatever is
configured. Outside tests:

| Variable | Effect when `true` | When `false` and keys are blank |
| --- | --- | --- |
| `WHATSAPP_SIMULATE` | Every WhatsApp send, onboarding step and template sync is faked | Sends without any connection are recorded as not delivered, with the reason |
| `TELEPHONY_SIMULATE` | Twilio calls are faked | Click-to-call is refused with "No telephony account is configured" |
| `EXOTEL_SIMULATE` | Exotel calls and validation are faked | Exotel click-to-call is refused until validated |
| `RAZORPAY_SIMULATE` | Razorpay links, refunds and validation are faked | Creating an invoice payment link is refused until a gateway is connected |
| `STRIPE_SIMULATE` | Stripe checkout and validation are faked | Same as Razorpay (a link needs either gateway) |
| `BILLING_SIMULATE` | Platform billing creates canned subscriptions even with live keys | Real gateway calls with the platform keys |

`BILLING_SIMULATE=true` is the default in `.env.example`. Email and AI have no switch: email
is simulated exactly when `AWS_SES_FROM_EMAIL` is blank, AI exactly when every AI key is blank.

## Email: Amazon SES

```bash
AWS_SES_REGION=us-east-1
AWS_SES_ACCESS_KEY=           # optional: blank uses the default AWS credential chain
AWS_SES_SECRET_KEY=
AWS_SES_FROM_EMAIL=crm@mail.example.com      # the platform sender
AWS_SES_FROM_NAME=Open CRM
APP_PUBLIC_URL=https://crm-api.example.com   # unsubscribe links point here
```

- `AWS_SES_FROM_EMAIL` makes SES live (`sesConfigured` in
  [`apps/api/src/utils/aws.ts`](../../apps/api/src/utils/aws.ts), used by
  [`email-ses.client.ts`](../../apps/api/src/services/email-ses.client.ts)); under tests it is
  always simulated. While SES is simulated, sending domains get fake DKIM tokens and never
  verify.
- `AWS_SES_FROM_EMAIL` must be a verified SES identity. Blank: mail from workspaces with no
  verified domain of their own is simulated
  ([`apps/api/src/services/mailer.service.ts`](../../apps/api/src/services/mailer.service.ts)).
- The SES account must be out of the SES sandbox to mail arbitrary recipients.
- `AWS_SES_REGION` falls back to `AWS_REGION`.

Credentials: when `AWS_SES_ACCESS_KEY` and `AWS_SES_SECRET_KEY` are both set, the SES, SNS and
SQS clients use them; otherwise they use the default AWS credential chain, so on ECS the task
role is enough and no keys are needed. `AWS_ENDPOINT_URL` points them at an emulator. See
[channels.md](../architecture/channels.md#inbound-mail).

### Delivery events (opens, clicks, bounces, complaints)

```bash
SES_EVENTS_SNS_TOPIC_ARN=arn:aws:sns:us-east-1:111122223333:crm-ses-events
SES_EVENTS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/111122223333/crm-ses-events
```

[`apps/api/scripts/ses-infra-setup.ts`](../../apps/api/scripts/ses-infra-setup.ts) creates
the SNS topic `crm-ses-events`, the SQS queue `crm-ses-events` with a dead-letter queue
(`crm-ses-events-dlq`), subscribes the queue to the topic with raw delivery, and prints both
values. It is safe to re-run. Run it from `apps/api` with AWS credentials available (SES keys
in `.env`, or the default credential chain):

```bash
pnpm exec tsx scripts/ses-infra-setup.ts
```

On AWS you do not need the script: the Terraform email module
([`infra/terraform/modules/email`](../../infra/terraform/modules/email)) creates the
configuration set, the SNS topic, the SQS queue with its dead-letter queue and the inbound
receipt rule.

With the topic set, each workspace's SES configuration set publishes send, delivery,
bounce, complaint, reject, open and click events to it. Without the queue URL, the events
consumer stays idle and bounces never reach suppressions or reputation.

### Inbound mail

```bash
SES_INBOUND_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/111122223333/crm-ses-inbound
SES_INBOUND_REGION=us-east-1     # in config/index.ts, not in .env.example
```

Create an SES receipt rule for the workspaces' sending domains that publishes to SNS, and an
SQS queue subscribed to that topic. The setup script does not create these. An inbound
message is matched to a workspace by the recipient's domain, which must be that
workspace's sending domain.

### Throttle

`EMAIL_DEFAULT_TENANT_TPS` (5) per workspace, `EMAIL_ACCOUNT_TPS` (falls back to
`EMAIL_MAX_SEND_PER_SECOND`, 14) for the whole deployment. Set the account ceiling to your
SES sending rate. The throttle needs Redis (`REDIS_URL`); without it every send is allowed.

## WhatsApp: Meta Cloud API

### Platform default number

```bash
WHATSAPP_PHONE_NUMBER_ID=123456789012345
WHATSAPP_API_KEY=EAAG...                   # a system user access token
WHATSAPP_API_VERSION=v21.0                 # also accepted as META_GRAPH_API_VERSION
WHATSAPP_DEFAULT_TEMPLATE_LANG=en_US
WHATSAPP_SIMULATE=false
```

Every workspace without its own connection sends from this number.

### Embedded Signup (workspaces connect their own number)

```bash
META_APP_ID=...
META_APP_SECRET=...
META_WEBHOOK_VERIFY_TOKEN=a-long-random-string
```

1. In a Meta app with WhatsApp and Embedded Signup set up, configure the webhook callback
   as `{APP_PUBLIC_URL}/api/v1/wa/webhooks/whatsapp` with `META_WEBHOOK_VERIFY_TOKEN` as the
   verify token, and subscribe to `messages`.
2. Set the three variables. The WhatsApp page then shows a Connect button; without
   `META_APP_ID` and `META_APP_SECRET` it is hidden.
3. A workspace admin connects their own WABA and number in the popup. The CRM exchanges the
   code, registers the number, subscribes the app to the WABA and stores the token
   encrypted.

`META_APP_SECRET` also verifies every webhook's `X-Hub-Signature-256` on the shared webhook
(a tenant's own app secret does it on the per-tenant path). With no signing secret, production
(`NODE_ENV=production`) refuses the webhook with `401 Webhook signing secret not configured`;
outside production the payload is processed unverified with a warning. The web app reads the
Graph API version from `VITE_META_GRAPH_API_VERSION`.

### Testing safely

`WHATSAPP_TEST_ALLOWLIST=+15550100001,+15550100002`: when set, only these numbers receive
real messages; every other send is recorded as simulated, so testing against real leads
never spends the messaging limit.

## Telephony: Twilio

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_DEFAULT_FROM_NUMBER=+15550100000
TELEPHONY_SIMULATE=false
```

All three must be set for the platform default to be live. Workspaces can save their own
Twilio account on the Telephony page and press Validate. Twilio call status is polled every
15 seconds, so no public webhook URL is needed. Twilio calls are not recorded or
transcribed by the CRM.

## Telephony: Exotel

No environment variables: each workspace connects its own account on the Telephony page.
Only `EXOTEL_SIMULATE` exists, and `APP_PUBLIC_URL` must be reachable by Exotel, because
the webhook URLs and the click-to-call status callback are built from it. Full guide:
[telephony-exotel.md](telephony-exotel.md).

## Calendar: Google

```bash
GOOGLE_CLIENT_ID=....apps.googleusercontent.com        # or GOOGLE_CALENDAR_CLIENT_ID
GOOGLE_CLIENT_SECRET=...                               # or GOOGLE_CALENDAR_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URL=https://crm-api.example.com/api/v1/oauth/google/calendar/callback
GOOGLE_CALENDAR_ENABLED=true
CRM_APP_URL=https://crm.example.com
```

1. In a Google Cloud project, enable the Google Calendar API and create an OAuth client of
   type "Web application".
2. Register the redirect URL exactly. It defaults to
   `{APP_PUBLIC_URL}/api/v1/oauth/google/calendar/callback`; `GOOGLE_CALENDAR_REDIRECT_URI`
   is an accepted alias.
3. The scopes requested are `calendar.events` and `calendar.freebusy`, with offline access
   ([`apps/api/src/services/google-calendar.service.ts`](../../apps/api/src/services/google-calendar.service.ts)).

The `GOOGLE_CALENDAR_*` names win over the short ones when both are set. Each user connects
their own Google account from the Calendar page; their refresh token is stored encrypted.
With the client id or secret blank, or `GOOGLE_CALENDAR_ENABLED=false`, nothing calls
Google and online meetings get a Jitsi link.

## Payments: Razorpay and Stripe

Two different uses share the platform keys.

### Workspace invoices (the finance module)

```bash
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_SIMULATE=false
STRIPE_SECRET_KEY=sk_live_...
STRIPE_CURRENCY=inr          # or usd for a USD Stripe account
STRIPE_SIMULATE=false
```

A workspace's invoices create payment links on the workspace's own Razorpay or Stripe
account when connected (Finance, payment gateways), else on the platform keys. The workspace's default gateway is tried first, then the other
([`apps/api/src/services/payment-gateway.service.ts`](../../apps/api/src/services/payment-gateway.service.ts)).
Link status is polled by the `payments-poll` job every 30 seconds; no webhook is needed for
this path.

### Platform billing (the operator charges workspaces)

```bash
BILLING_SIMULATE=false
BILLING_GRACE_DAYS=3
BILLING_RETURN_URL=https://crm.example.com/login
RAZORPAY_WEBHOOK_SECRET=...
STRIPE_WEBHOOK_SECRET=whsec_...
```

Uses the same `RAZORPAY_*` and `STRIPE_SECRET_KEY`. Point the gateways' webhooks at
`{APP_PUBLIC_URL}/api/v1/operator/webhooks/razorpay` and
`{APP_PUBLIC_URL}/api/v1/operator/webhooks/stripe`. With a webhook secret blank, every
webhook from that gateway fails verification; the `billing-payment-poll` job still checks
pending payments every 30 seconds. `BILLING_RETURN_URL` defaults to
`{CRM_APP_URL}/login`. Details: [platform-billing.md](../architecture/platform-billing.md).

## AI: Gemini, OpenAI or Anthropic

```bash
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

Set one. If several are set, the first in the order Gemini, OpenAI, Anthropic is used for
everything. Optional model overrides: `AI_EMAIL_GEMINI_MODEL`, `AI_EMAIL_OPENAI_MODEL`,
`AI_EMAIL_ANTHROPIC_MODEL`. Call recordings are transcribed only with an OpenAI or Gemini
key. With no key, the deterministic offline provider answers
([ai.md](../architecture/ai.md)).

## Files: S3

```bash
AWS_S3_BUCKET=crm-files-example
AWS_REGION=us-east-1
AWS_S3_ACCESS_KEY=           # optional; blank uses the default AWS credential chain
AWS_S3_SECRET_KEY=
AWS_ENDPOINT_URL=            # an S3-compatible emulator during development
```

With `AWS_S3_BUCKET` blank, files (lead documents, call recordings) are written under
`LOCAL_STORAGE_DIR` (default `.local-storage` in the working directory) and served from
`{APP_PUBLIC_URL}/local-files/...` only through HMAC-signed links that expire. With a bucket,
downloads are presigned S3 URLs
([`apps/api/src/services/storage.service.ts`](../../apps/api/src/services/storage.service.ts)).
`AWS_ENDPOINT_URL` is passed to the S3 client with path-style addressing.

## Check what is live

The API logs, at boot, which mode each provider started in: for example
`AI provider: openai (real, model gpt-4o-mini)`, `Email domains: simulated (AWS_SES_FROM_EMAIL unset)`,
`SES events consumer idle (SES_EVENTS_QUEUE_URL unset)`, `Storage: local disk at ...`. The
channel pages also show when a channel is simulated.
