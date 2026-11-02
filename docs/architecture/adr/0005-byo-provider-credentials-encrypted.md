# ADR 0005: Workspaces bring their own provider accounts; secrets encrypted, never returned

## Status

Accepted.

## Context

A CRM sends from the customer's own identity: their email domain, their WhatsApp number,
their phone numbers, their payment account. If every workspace sent through the operator's
accounts, one workspace's spam complaints would pause everyone's email, one workspace's
WhatsApp quality rating would block everyone, and invoices would be paid into the
operator's bank account. So each workspace connects its own providers, which means the
database holds many third-party secrets: Twilio and Exotel tokens, WhatsApp access tokens
and registration PINs, Razorpay and Stripe secret keys, Google refresh tokens, integration
credentials, outbound webhook signing secrets.

## Decision

- **Two tiers per channel.** A resolver per provider picks the workspace's own `ACTIVE`
  connection, else the platform default from environment variables, else none
  ([`apps/api/src/services/telephony-resolver.service.ts`](../../../apps/api/src/services/telephony-resolver.service.ts),
  [`whatsapp-resolver.service.ts`](../../../apps/api/src/services/whatsapp-resolver.service.ts),
  [`razorpay-resolver.service.ts`](../../../apps/api/src/services/razorpay-resolver.service.ts),
  [`stripe-resolver.service.ts`](../../../apps/api/src/services/stripe-resolver.service.ts),
  [`email-resolver.service.ts`](../../../apps/api/src/services/email-resolver.service.ts)).
  Exotel and Google Calendar have no platform tier. A connection becomes `ACTIVE` only
  after it validates against the provider.
- **Encrypted at rest.** [`apps/api/src/utils/crypto.ts`](../../../apps/api/src/utils/crypto.ts):
  AES-256-GCM with a random 12 byte IV per value, stored as
  `base64(iv).base64(tag).base64(ciphertext)`. The key is the SHA-256 of
  `CREDENTIALS_ENCRYPTION_KEY`, so any string of 32 or more characters works.
  `encryptSecret` and `decryptSecret` serve the dedicated `*_encrypted` columns.
  `sealSecret` and `openSecret` serve columns that predate encryption (integration
  credentials, webhook signing secrets): sealed values carry an `enc:v1:` prefix and
  `openSecret` returns older plaintext rows unchanged, so they keep working.
- **Write-only.** No endpoint returns a stored secret. Config reads return masked ids and
  flags such as `auth_token_set`, `api_key_set`, `access_token_set` and `key_secret_set`
  ([`telephony.service.ts`](../../../apps/api/src/services/telephony.service.ts),
  [`whatsapp-config.service.ts`](../../../apps/api/src/services/whatsapp-config.service.ts),
  [`razorpay-config.service.ts`](../../../apps/api/src/services/razorpay-config.service.ts)).
  Integration rows and webhooks are listed without their credentials and secret; a webhook
  signing secret is shown once, when it is created
  ([`integrations.service.ts`](../../../apps/api/src/services/integrations.service.ts)).
  To change a secret, an admin enters a new one.
- **Decrypted only to use.** Resolvers decrypt into memory at the moment of a provider
  call. A value that no longer decrypts is treated as absent and the resolver falls back to
  the next tier.
- **Production guard.** `assertProductionConfig` refuses to start with
  `NODE_ENV=production` when `CREDENTIALS_ENCRYPTION_KEY` is the development default or
  shorter than 32 characters ([`apps/api/src/config/index.ts`](../../../apps/api/src/config/index.ts)).
  `TELEPHONY_ENCRYPTION_KEY` is accepted as an older name.

## Consequences

Positive:

- One workspace's reputation, quality rating or payment disputes stay with that workspace.
- A database dump alone does not reveal provider secrets.
- An admin, or anyone who takes over an admin session, cannot read secrets back out of the
  UI or the API.
- A deployment with no provider accounts still works through the platform tier or
  simulation ([ADR 0006](0006-simulated-providers-for-local-and-tests.md)).

Trade-offs:

- `CREDENTIALS_ENCRYPTION_KEY` is critical: losing it means every workspace reconnects
  every provider; leaking it together with a dump reveals them all. It belongs in a secrets
  manager.
- One key for everything, with no key id in the ciphertext, no key versioning and no KMS
  envelope encryption. Rotating it is an offline re-encryption, not a config change. This
  is listed under known gaps in [security.md](../security.md).
- Some inbound URL tokens are not secrets in this sense and are stored and shown in
  plaintext to admins: the Exotel webhook token, the WhatsApp verify token and the lead
  ingest token. They must be copied into another system, so they are displayed.
- Validation calls the provider, so connecting is only as reliable as the provider's API at
  that moment.

## Alternatives considered

- **Only platform accounts.** Simple, but mixes every workspace's reputation and money.
- **A secrets manager entry per credential.** Strong, but adds a cloud dependency and a
  network hop to every send and makes local development harder.
- **Reveal endpoints for admins.** Convenient for copying a key elsewhere, but turns every
  admin session into a way to exfiltrate provider secrets.
