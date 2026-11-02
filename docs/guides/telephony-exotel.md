# Telephony with Exotel

Connect a workspace's own Exotel account so that leads calling the business number reach
the right agent, every call is recorded onto the lead, and agents click to call with an
ExoPhone as caller id. Exotel is bring-your-own: there is no platform Exotel account. The
channel overview is [../architecture/channels.md](../architecture/channels.md#4-telephony).
Paths are relative to the repository root.

## How it works

**Inbound.** A caller dials one of the workspace's ExoPhones. Exotel's call flow asks the
CRM who should pick up (the Route URL). The CRM answers with one phone number per attempt,
in this order
([`apps/api/src/services/telephony-routing.service.ts`](../../apps/api/src/services/telephony-routing.service.ts)):

1. **Dedicated number.** The dialled ExoPhone is an agent line assigned to an agent: that
   agent.
2. **Sticky agent.** The lead's owner, or else the agent who last completed a call with
   the lead.
3. **Cascade.** The available agent who was called least recently.

An agent is only rung when their account is `ACTIVE`, **Available for calls** is on, and a
calling number is linked. Each pick is remembered on the call, and when the agent does not
answer Exotel fetches the URL again and gets the next agent. When nobody is left, or the
workspace is outside its working hours (Settings, working hours), the CRM answers with an
empty list and Exotel plays the flow's failure branch.

The first fetch for a call matches the caller's number to a lead, then a contact. An
unknown number becomes a new lead with source `Phone call`
([`apps/api/src/services/exotel-webhook.service.ts`](../../apps/api/src/services/exotel-webhook.service.ts)).

When the flow ends, Exotel reports the result (the Status URL). The CRM records the status,
duration, recording URL and which agent answered (matched by the phone Exotel dialled). A
missed call creates a `HIGH` priority task "Call back ... (missed call)" due in two hours,
owned by the sticky agent (unassigned when there is none). An answered call goes to the
post-call pipeline (below).

**Outbound.** An agent presses Call on a lead or contact. Exotel rings the agent's phone
first, then the lead. The lead sees the agent's own agent line as caller id when they have
one, else the workspace's main ExoPhone. Exotel reports status to the Callback URL
([`apps/api/src/services/telephony.service.ts`](../../apps/api/src/services/telephony.service.ts)).

**Why caller id is always an ExoPhone.** Exotel's API requires a caller id the account
leases. A call an agent dials from a personal phone never touches Exotel, so the CRM
cannot record it: use **Log call** on the lead or contact for those (duration, outcome,
notes, no recording).

## Prerequisites

- An Exotel account with at least one ExoPhone (KYC-approved for Indian numbers).
- The account **SID**, **API key** and **API token** (Exotel dashboard, Settings, API).
- The account's API host: `api.in.exotel.com` (the default) or `api.exotel.com`
  ([`apps/api/src/services/exotel.client.ts`](../../apps/api/src/services/exotel.client.ts)).
- The API reachable from the internet at `APP_PUBLIC_URL`, or the webhooks cannot arrive.

## 1. Connect the workspace

In the CRM: **Channels, Telephony**, choose the **Exotel** card, enter the SID, API key,
API token, API host and the main ExoPhone, **Save**, then **Validate**.

- Saving stores the API key and token encrypted
  ([ADR 0005](../architecture/adr/0005-byo-provider-credentials-encrypted.md)); the page
  only ever shows that they are set. Saving also mints the workspace's webhook token (24
  random bytes, hex).
- Validation checks the credentials with Exotel, sets the connection `ACTIVE`, and adds the
  main ExoPhone to the number pool as `MAIN`.
- The card then shows three webhook URLs with copy buttons:

| URL | Path | Called by |
| --- | --- | --- |
| Route URL | `GET /api/v1/telephony/webhooks/exotel/{token}/route` | The Connect applet, once per dial attempt |
| Status URL | `GET /api/v1/telephony/webhooks/exotel/{token}/status` | The Passthru applet at the end of the flow |
| Callback URL | `POST /api/v1/telephony/webhooks/exotel/{token}/callback` | Exotel, for calls the CRM places |

Exotel signs none of its callbacks. The token in the path is the whole authentication, so
treat the URLs like passwords. An unknown token gets a bare `404`
([`apps/api/src/controllers/exotel-webhook.controller.ts`](../../apps/api/src/controllers/exotel-webhook.controller.ts)).
These routes are mounted before the API-wide rate limiter, because a throttled Route URL is
a caller hearing silence ([`apps/api/src/app.ts`](../../apps/api/src/app.ts)).

## 2. Build the inbound call flow

In the Exotel dashboard:

1. **App Bazaar, Create App.**
2. Add a **Connect** applet. Under "Connect to", choose **Try number fetched from URL** and
   paste the **Route URL**.
3. On the same applet turn on **If call not answered, try next number from URL**. This is
   what makes the cascade work. The CRM's answer already asks for dual-channel recording,
   a 25 second ring time and a one hour call limit.
4. On the Connect applet's failure branch (nobody answered, or nobody dialled), add your
   voicemail or announcement. It also plays outside working hours.
5. Add a **Passthru** applet as the **last** step, paste the **Status URL**, and tick
   **Make Passthru Async**.
6. Save the app and assign it to the main ExoPhone.

The Callback URL needs no setup: click-to-call passes it to Exotel on every call.

The Route URL has to answer inside Exotel's five second budget, so that path only does
indexed database lookups. If routing fails for any reason, it answers "nobody to dial" so
the caller reaches the failure branch instead of waiting.

## 3. Per-agent numbers

Buy one ExoPhone per agent, assign the same app to each in Exotel, then in the CRM:
**Channels, Telephony, ExoPhone numbers, Add number**, kind **Agent line**, and pick the
agent (`telephony_numbers`, [`apps/api/src/services/telephony.service.ts`](../../apps/api/src/services/telephony.service.ts)).

- That agent's outbound calls always show their own number, so leads can recognise and
  save it, and call volume is spread across numbers.
- A lead calling that number back rings that agent first, then the normal order.

## 4. Agents

Each agent needs:

- A **Calling number**: their real mobile, set from the avatar menu or by an admin under
  Users & Roles. Inbound calls ring it, click-to-call rings it first, and post-call agent
  matching compares against it.
- **Available for calls** (avatar menu) switched off when they should be skipped, for
  example in meetings or on leave.

## 5. Outbound rules

- Click-to-call through Exotel is refused outside **09:00 to 21:00 IST**, the window
  India's telecom regulator (TRAI) allows for commercial calls. The rule uses IST whatever
  the workspace's timezone, and applies in simulated mode too
  (`isWithinTraiWindow` in
  [`apps/api/src/services/telephony-routing.service.ts`](../../apps/api/src/services/telephony-routing.service.ts)).
  Agents see the reason. It is not applied to Twilio calls.
- Both phone numbers must be valid E.164 (with country code), or the call is refused with
  a message saying which one.
- Calls made from a personal phone can be logged with **Log call**.

## 6. Recordings and summaries

[`apps/api/src/services/call-intelligence.service.ts`](../../apps/api/src/services/call-intelligence.service.ts)
runs after each finished Exotel call:

- **Mirror.** Exotel's recording URLs need API credentials, so the CRM downloads the file
  and stores it as `telephony/<tenantId>/<callSid>.mp3` in S3 or on local disk
  ([`apps/api/src/services/storage.service.ts`](../../apps/api/src/services/storage.service.ts)).
  The play button asks for a link that expires after one hour. Until the mirror lands the
  recording shows as still processing.
- **Transcript and summary.** With `OPENAI_API_KEY` (Whisper) or `GEMINI_API_KEY`, the
  recording is transcribed, summarised by the AI provider and given a sentiment score.
  Without either key the call still gets its recording, duration, direction and agent.
- **Timeline.** Once per call: a `CALL` activity on the lead or contact, the lead's last
  activity updated and its score recomputed.

## 7. Reconciliation

The `exotel-sync` job runs every 30 seconds on the jobs worker
([`apps/api/src/jobs/exotel-sync.job.ts`](../../apps/api/src/jobs/exotel-sync.job.ts)):

- Calls not terminal after two minutes (a callback that never arrived) are fetched from
  Exotel's Call API and finalised.
- Finished calls whose recording is still Exotel's URL are retried for two hours, because
  Exotel often publishes the recording minutes after the final callback.

It does nothing when no workspace uses Exotel.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Inbound calls go straight to voicemail | The Route URL is unreachable (check `APP_PUBLIC_URL`), the workspace is outside working hours, or no agent is available with a calling number |
| Calls route but the wrong agent is credited | The answering agent's calling number in the CRM does not match the number Exotel dialled |
| "Recording is still processing" never clears | Recording is not enabled on the flow, or the mirror keeps failing: look for `exotel` warnings in the API log. Retries stop after two hours |
| Webhook URLs stopped working | Disconnecting Exotel deletes the configuration and its token. Reconnecting mints new URLs that must be pasted into the flow again |
| Click-to-call refused with a TRAI message | It is outside 09:00 to 21:00 IST |
| Click-to-call says the settings are not validated | Press Validate on the Exotel card |

## For developers

- Run the whole flow without an Exotel account: `EXOTEL_SIMULATE=true`. Tests always
  simulate. Simulated calls get `sim_` ids and are skipped by `exotel-sync`.
- The schema (`tenant_telephony`, `telephony_numbers`, `voice_calls`) is in
  [`db/migrations/0001_init.sql`](../../db/migrations/0001_init.sql).
- Tests: [`apps/api/tests/api/exotel-webhook.test.ts`](../../apps/api/tests/api/exotel-webhook.test.ts),
  [`apps/api/tests/api/exotel-config.test.ts`](../../apps/api/tests/api/exotel-config.test.ts),
  [`apps/api/tests/unit/telephony-routing.test.ts`](../../apps/api/tests/unit/telephony-routing.test.ts).
