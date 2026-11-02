# ADR 0006: Every outside provider has a simulated mode, built into its client

## Status

Accepted.

## Context

Euron Open CRM talks to many outside services: SES, Meta's WhatsApp Cloud API, Twilio,
Exotel, Razorpay, Stripe, Google Calendar, Gemini, OpenAI and Anthropic. Someone trying the
product, a contributor, or CI should not need an account with any of them, and no test may
send a real email, place a real call or charge a real card. At the same time the code paths
around each provider (resolvers, status tracking, the inbox, campaigns, the sales agent)
are where most of the logic is, so they must run in development and in tests, not be
skipped.

## Decision

Each provider client decides for itself whether it is live, and when it is not it returns a
well-formed fake result through the same interface. There is no separate stub server.

| Client | Simulated when |
| --- | --- |
| [`email-ses.client.ts`](../../../apps/api/src/services/email-ses.client.ts), [`mailer.service.ts`](../../../apps/api/src/services/mailer.service.ts) | Under test, or SES keys blank; platform sends also when `AWS_SES_FROM_EMAIL` is blank |
| [`whatsapp.client.ts`](../../../apps/api/src/services/whatsapp.client.ts) | Under test, `WHATSAPP_SIMULATE=true`, or no credentials for the send |
| [`twilio.client.ts`](../../../apps/api/src/services/twilio.client.ts) | Under test, `TELEPHONY_SIMULATE=true`, or no credentials |
| [`exotel.client.ts`](../../../apps/api/src/services/exotel.client.ts) | Under test, `EXOTEL_SIMULATE=true`, or no credentials |
| [`razorpay.client.ts`](../../../apps/api/src/services/razorpay.client.ts), [`stripe.client.ts`](../../../apps/api/src/services/stripe.client.ts) | Under test, `RAZORPAY_SIMULATE` or `STRIPE_SIMULATE`, or no credentials |
| [`platform-gateway.service.ts`](../../../apps/api/src/services/operator/platform-gateway.service.ts) | Under test or `BILLING_SIMULATE=true` |
| [`ai/provider.ts`](../../../apps/api/src/services/ai/provider.ts) | Under test, or no AI key: the deterministic heuristics in [`ai/heuristics.ts`](../../../apps/api/src/services/ai/heuristics.ts) |
| [`storage.service.ts`](../../../apps/api/src/services/storage.service.ts) | `AWS_S3_BUCKET` blank: local disk with HMAC-signed, expiring links |
| [`google-calendar.service.ts`](../../../apps/api/src/services/google-calendar.service.ts) | Client id or secret blank, or `GOOGLE_CALENDAR_ENABLED=false`: meetings get a Jitsi link |

"Under test" is `NODE_ENV=test` or Vitest running, and it wins over any configured key, so
a developer's real keys in `.env` can never leak into a test run
([`apps/api/tests/setup-env.ts`](../../../apps/api/tests/setup-env.ts)).

Rules every simulated path follows:

- **Recorded honestly.** Outbound messages carry `messages.simulated`; calls get `sim_`
  ids; payment links `plink_sim_` ids. A campaign counts `simulated` separately from
  `sent`. Nothing simulated is reported as delivered.
- **Deterministic.** Fake DKIM tokens are derived from the domain, heuristic AI answers
  from their inputs, so tests can assert on them.
- **Same shape.** Callers do not branch on simulation; they read `simulated` from the
  result.
- **Pollers skip fakes.** Jobs that reconcile with a provider ignore simulated ids
  (`exotel-sync`, `payments-poll`), and jobs that need a live provider do nothing without
  one (`verify-domains`, `health-sweep`, `calls-poll`).
- **Visible.** Each client logs its mode at boot, and config endpoints return a
  `simulated` flag so the UI can say so.

## Consequences

Positive:

- `pnpm demo:seed` and a browser are enough to use every feature, including campaigns,
  the inbox, calls and invoices.
- Tests exercise the real services and repositories around each provider with no network
  and no secrets.
- Going live is configuration only: set the keys, unset the switch
  ([../../guides/connect-providers.md](../../guides/connect-providers.md)).

Trade-offs:

- Simulation lives inside production clients, so a wrong flag in production silently
  simulates a channel instead of failing. The boot log and the UI flags are the only
  signal; there is no production guard against `*_SIMULATE=true`.
- The fakes do not reproduce provider behaviour (rate limits, Meta's 24 hour window,
  template rejection, SES sandbox rules). Those are found only against real accounts.
- Under test, call transcription and real AI calls are skipped, so model prompts and
  response parsing are covered only by the heuristic fallbacks and unit tests of the
  parsers.

## Alternatives considered

- **A stub server speaking each provider's wire format.** Exercises the HTTP clients too,
  but is a second codebase to keep faithful to nine providers.
- **Mocking at the test level only.** Leaves development and demos needing real accounts.
- **Feature flags that hide unconfigured channels.** Simpler UI, but a new deployment would
  show an empty product.
