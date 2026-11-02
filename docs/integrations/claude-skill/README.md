# Claude Code skill: open-crm-integration

A Claude Code skill for the other side of the integration. Copy it into a product's
repository and Claude can wire that product into Euron Open CRM without anyone reading
this codebase first.

It lives next to the API it describes for the same reason the ingest contract is served by
the API itself: a copy kept elsewhere drifts. When an ingest endpoint changes,
`open-crm-integration/` changes in the same commit.

| File | Contents |
| --- | --- |
| [`open-crm-integration/SKILL.md`](open-crm-integration/SKILL.md) | What to wire, in which order, and how to prove each part works |
| [`open-crm-integration/reference.md`](open-crm-integration/reference.md) | Payloads, the event vocabulary, signature verification code, common failures |

## Install it in a product's repository

```bash
# from the product repository you are integrating
mkdir -p .claude/skills
cp -r /path/to/your-crm-checkout/docs/integrations/claude-skill/open-crm-integration .claude/skills/
```

Or for one engineer, user-wide:

```bash
cp -r /path/to/your-crm-checkout/docs/integrations/claude-skill/open-crm-integration ~/.claude/skills/
```

Claude picks it up from the `description` in the frontmatter when someone asks to
integrate with the CRM, send product events, sync a catalog, or verify an
`X-CRM-Signature`. It can also be invoked directly:

```
/open-crm-integration catalog
```

## What the integrating team needs first

1. The CRM API origin, for example `https://crm-api.example.com`.
2. A connected product created in the CRM, with their web origin in its allowed origins if
   they want the browser tracker.
3. A `crm_sk_` secret key, and a `crm_pk_` publishable key if they embed the tracker. Each
   is shown once.

Everything else the skill can read from `GET {BASE}/api/v1/ingest/openapi.json`.

## Keeping it honest

The skill hardcodes facts that are cheap to get wrong: minor-unit money, the event-name
pattern, the semantic vocabulary and its weights, the signature scheme and headers, the
retry ladder, and the meaning of `matched: false`. Their sources:

| Fact | Code |
| --- | --- |
| Endpoints, key scopes, limits | [`routes/ingest.route.ts`](../../../apps/api/src/routes/ingest.route.ts), [`middlewares/api-key.middleware.ts`](../../../apps/api/src/middlewares/api-key.middleware.ts), [`middlewares/rate-limit.middleware.ts`](../../../apps/api/src/middlewares/rate-limit.middleware.ts) |
| Event names, weights, lifecycle | [`constants/semantic-events.const.ts`](../../../apps/api/src/constants/semantic-events.const.ts), [`services/activity-events.service.ts`](../../../apps/api/src/services/activity-events.service.ts) |
| Catalog rules | [`services/catalog-mapping.ts`](../../../apps/api/src/services/catalog-mapping.ts), [`services/catalog-sync.service.ts`](../../../apps/api/src/services/catalog-sync.service.ts) |
| Signature, headers, retries | [`utils/webhook-signature.ts`](../../../apps/api/src/utils/webhook-signature.ts), [`services/webhook-dispatch.service.ts`](../../../apps/api/src/services/webhook-dispatch.service.ts), [`services/product-actions.service.ts`](../../../apps/api/src/services/product-actions.service.ts) |
| Tracker | [`services/tracker-script.ts`](../../../apps/api/src/services/tracker-script.ts) |
| SDK | [`packages/sdk/src/index.ts`](../../../packages/sdk/src/index.ts) |

The API-side guards that keep the served contract truthful:

- [`tests/unit/ingest-openapi.test.ts`](../../../apps/api/tests/unit/ingest-openapi.test.ts)
  checks the spec against the router.
- [`tests/api/product-integration.test.ts`](../../../apps/api/tests/api/product-integration.test.ts)
  exercises the ingest routes against a real database.

Neither can see this skill, so it is the one artifact here that relies on review.
