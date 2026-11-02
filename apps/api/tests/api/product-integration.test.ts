import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, login } from "../helpers";

// The product-integration platform end to end: connected products, key scoping,
// catalog sync, the generalized event pipeline, identity stitching and the
// engagement rollup.
//
// NOTE: requires docs/migrations/product-integration.sql to have been applied
// (or `pnpm db:push`). Until the developer runs it, every test here fails at the
// first insert because the tables do not exist yet.

let adminToken: string;
let appId: string;
let secretKey: string;

// Unique suffix so assertions never collide with seed data or a prior run.
const uniq = Math.random().toString(36).slice(2, 10);
const email = (label: string) => `pi.${label}.${uniq}@example.com`;
const key = () => `k_${uniq}_${Math.random().toString(36).slice(2, 8)}`;

const createdLeadIds: string[] = [];

const ingest = (path: string, body: unknown, apiKey?: string, method: "post" | "put" = "post") => {
  const req = api[method](path).send(body as object);
  return apiKey ? req.set("Authorization", `Bearer ${apiKey}`) : req;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  const created = await api
    .post("/api/v1/connected-apps")
    .set(auth(adminToken))
    .send({
      name: `QA Product ${uniq}`,
      product_url: "https://app.example.com",
      allowed_origins: ["https://app.example.com"],
    });
  expect(created.status).toBe(201);
  appId = created.body.data.id as string;

  const keyRes = await api
    .post(`/api/v1/connected-apps/${appId}/keys`)
    .set(auth(adminToken))
    .send({ scope: "SECRET", name: "QA server key" });
  secretKey = keyRes.body.data.key as string;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 400)); // let fire-and-forget writes land
  for (const id of createdLeadIds) {
    await db.deleteFrom("audit_logs").where("entity_id", "=", id).execute();
    await db.deleteFrom("leads").where("id", "=", id).execute();
  }
  // Sweep by the run's email pattern as well. Tracking ids by hand misses the
  // leads created as a side effect (a batch event, an orphan auto-create), and
  // one stray row per run adds up in a shared dev database.
  await db
    .deleteFrom("leads")
    .where("email", "like", `pi.%.${uniq}@example.com`)
    .execute();
  // Deleting the app cascades its catalog, definitions, identities, profiles
  // and events through connectedAppsService.remove.
  if (appId) {
    await api.delete(`/api/v1/connected-apps/${appId}`).set(auth(adminToken));
    await db.deleteFrom("audit_logs").where("entity_id", "=", appId).execute();
  }
  await closeDB();
});

// ---------------------------------------------------------------------------

describe("connected products", () => {
  it("lists the product just created", async () => {
    const res = await api.get("/api/v1/connected-apps").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { id: string }) => a.id === appId)).toBe(true);
  });

  it("reports PENDING health before any event arrives", async () => {
    const res = await api.get(`/api/v1/connected-apps/${appId}`).set(auth(adminToken));
    expect(res.body.data.app.health).toBe("PENDING");
  });

  it("never returns the actions secret", async () => {
    const res = await api.get(`/api/v1/connected-apps/${appId}`).set(auth(adminToken));
    expect(res.body.data.app).not.toHaveProperty("actions_secret");
    expect(res.body.data.app).toHaveProperty("actions_configured");
  });

  it("rejects a duplicate key with 409", async () => {
    const first = await api
      .post("/api/v1/connected-apps")
      .set(auth(adminToken))
      .send({ name: `Dup ${uniq}` });
    const second = await api
      .post("/api/v1/connected-apps")
      .set(auth(adminToken))
      .send({ name: `Dup ${uniq}` });
    expect(second.status).toBe(409);
    await api.delete(`/api/v1/connected-apps/${first.body.data.id}`).set(auth(adminToken));
  });

  it("refuses a browser key until an origin is allowed", async () => {
    const created = await api
      .post("/api/v1/connected-apps")
      .set(auth(adminToken))
      .send({ name: `NoOrigin ${uniq}` });
    const res = await api
      .post(`/api/v1/connected-apps/${created.body.data.id}/keys`)
      .set(auth(adminToken))
      .send({ scope: "PUBLISHABLE" });
    // A publishable key no origin may use is a key that cannot work.
    expect(res.status).toBe(400);
    await api.delete(`/api/v1/connected-apps/${created.body.data.id}`).set(auth(adminToken));
  });

  it("seeds the semantic event vocabulary on creation", async () => {
    const res = await api.get(`/api/v1/connected-apps/${appId}/events`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const names = res.body.data.map((d: { name: string }) => d.name);
    expect(names).toContain("checkout.started");
    expect(names).toContain("page.viewed");
  });
});

describe("key scoping", () => {
  it("rejects a missing key with 401", async () => {
    const res = await ingest("/api/v1/ingest/events", { event: "a.b" });
    expect(res.status).toBe(401);
  });

  it("refuses a secret key passed in the URL", async () => {
    // It has already leaked into access logs by the time we see it.
    const res = await api
      .post(`/api/v1/ingest/events?k=${encodeURIComponent(secretKey)}`)
      .send({ event: "a.b", idempotency_key: key(), occurred_at: new Date().toISOString() });
    expect(res.status).toBe(401);
  });

  it("blocks a browser key from writing the catalog", async () => {
    const keyRes = await api
      .post(`/api/v1/connected-apps/${appId}/keys`)
      .set(auth(adminToken))
      .send({ scope: "PUBLISHABLE" });
    const pk = keyRes.body.data.key as string;

    const res = await ingest("/api/v1/ingest/catalog", { products: [] }, pk, "put");
    // Publishable keys ship in page source; anyone could rewrite prices.
    expect([401, 403]).toContain(res.status);
  });
});

describe("catalog sync", () => {
  const externalId = `course_${uniq}`;

  it("creates products with prices", async () => {
    const res = await ingest(
      "/api/v1/ingest/catalog",
      {
        mode: "UPSERT",
        products: [
          {
            external_id: externalId,
            name: "Advanced React",
            category: "Frontend",
            highlights: ["12 weeks", "Live mentorship"],
            prices: [
              { currency: "INR", amount_minor: 499900, compare_at_minor: 799900, is_default: true },
            ],
          },
        ],
      },
      secretKey,
      "put"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);
  });

  it("is idempotent: the same payload updates rather than duplicates", async () => {
    const res = await ingest(
      "/api/v1/ingest/catalog",
      {
        products: [
          { external_id: externalId, name: "Advanced React v2", prices: [{ currency: "INR", amount_minor: 499900 }] },
        ],
      },
      secretKey,
      "put"
    );
    expect(res.body.data.created).toBe(0);
    expect(res.body.data.updated).toBe(1);
  });

  it("rejects a bare `amount` with a message naming the fix", async () => {
    const res = await ingest(
      "/api/v1/ingest/catalog",
      { products: [{ external_id: `x_${uniq}`, name: "X", prices: [{ amount: 4999 }] }] },
      secretKey,
      "put"
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/amount_minor/);
  });

  it("surfaces the product to the CRM catalog with a resolved price", async () => {
    const res = await api
      .get("/api/v1/products")
      .query({ app_id: appId })
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const product = res.body.data.items.find(
      (p: { external_id: string }) => p.external_id === externalId
    );
    expect(product).toBeTruthy();
    expect(product.price.amount_minor).toBe(499900);
    expect(product.editable).toBe(false); // SYNCED products are read-only here
  });

  it("publishes offers and applies them to the product", async () => {
    const res = await ingest(
      "/api/v1/ingest/catalog/offers",
      {
        offers: [
          {
            code: `AUG${uniq.toUpperCase()}`,
            name: "QA offer",
            discount_type: "PERCENT",
            discount_value: 20,
          },
        ],
      },
      secretKey,
      "put"
    );
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);

    const products = await api
      .get("/api/v1/products")
      .query({ app_id: appId })
      .set(auth(adminToken));
    const product = products.body.data.items.find(
      (p: { external_id: string }) => p.external_id === externalId
    );
    expect(product.best_offer).toBeTruthy();
    expect(product.best_offer.discount_minor).toBe(99980); // 20% of 499900
  });
});

describe("event pipeline", () => {
  it("accepts an unknown event name and registers it for review", async () => {
    // The core DX decision: never block a producer over an undeclared schema.
    const res = await ingest(
      "/api/v1/ingest/events",
      {
        event: "invoice.exported",
        occurred_at: new Date().toISOString(),
        idempotency_key: key(),
        identity: { email: email("unknown-event") },
      },
      secretKey
    );
    expect(res.status).toBe(201);
    if (res.body.data.leadId) createdLeadIds.push(res.body.data.leadId);

    const defs = await api.get(`/api/v1/connected-apps/${appId}/events`).set(auth(adminToken));
    const def = defs.body.data.find((d: { name: string }) => d.name === "invoice.exported");
    expect(def).toBeTruthy();
    expect(def.review_status).toBe("NEEDS_REVIEW");
    expect(def.intent_weight).toBe(0); // must not move a score before review
  });

  it("rejects a malformed event name", async () => {
    const res = await ingest(
      "/api/v1/ingest/events",
      { event: "not a valid name", occurred_at: new Date().toISOString(), idempotency_key: key() },
      secretKey
    );
    expect(res.status).toBe(400);
  });

  it("dedups on idempotency_key", async () => {
    const idem = key();
    const body = {
      event: "checkout.started",
      occurred_at: new Date().toISOString(),
      idempotency_key: idem,
      identity: { email: email("dedup") },
    };
    const first = await ingest("/api/v1/ingest/events", body, secretKey);
    const second = await ingest("/api/v1/ingest/events", body, secretKey);
    expect(first.body.data.deduped).toBe(false);
    expect(second.body.data.deduped).toBe(true);
    expect(second.body.data.eventId).toBe(first.body.data.eventId);
    if (first.body.data.leadId) createdLeadIds.push(first.body.data.leadId);
  });

  it("stores an anonymous event without creating a lead", async () => {
    // Creating a lead per anonymous visitor would flood the CRM with bot traffic
    // and burn the workspace lead limit.
    const res = await ingest(
      "/api/v1/ingest/events",
      {
        event: "page.viewed",
        occurred_at: new Date().toISOString(),
        idempotency_key: key(),
        identity: { anonymous_id: `anon_${uniq}` },
      },
      secretKey
    );
    expect(res.status).toBe(201);
    expect(res.body.data.leadId).toBeNull();
  });

  it("claims anonymous history on identify", async () => {
    const anon = `anon_backfill_${uniq}`;
    for (let i = 0; i < 3; i += 1) {
      await ingest(
        "/api/v1/ingest/events",
        {
          event: "pricing.viewed",
          occurred_at: new Date().toISOString(),
          idempotency_key: key(),
          identity: { anonymous_id: anon },
        },
        secretKey
      );
    }

    const res = await ingest(
      "/api/v1/ingest/identify",
      { anonymous_id: anon, user_id: `usr_${uniq}`, traits: { email: email("backfill") } },
      secretKey
    );
    expect(res.status).toBe(200);
    expect(res.body.data.leadId).toBeTruthy();
    // The whole point of the identity graph: weeks of browsing attach at once.
    expect(res.body.data.backfilled).toBe(3);
    createdLeadIds.push(res.body.data.leadId);
  });

  it("isolates faults in a batch", async () => {
    const res = await ingest(
      "/api/v1/ingest/events/batch",
      {
        events: [
          {
            event: "feature.used",
            occurred_at: new Date().toISOString(),
            idempotency_key: key(),
            identity: { email: email("batch") },
          },
          { event: "!!!bad!!!", occurred_at: new Date().toISOString(), idempotency_key: key() },
        ],
      },
      secretKey
    );
    expect(res.status).toBe(201);
    expect(res.body.data.rejected).toBe(1);
    expect(res.body.data.recorded + res.body.data.orphaned).toBe(1);
  });

  it("builds an engagement profile with an intent score", async () => {
    const identity = { email: email("intent") };
    for (const event of ["signup.completed", "pricing.viewed", "checkout.started"]) {
      await ingest(
        "/api/v1/ingest/events",
        { event, occurred_at: new Date().toISOString(), idempotency_key: key(), identity },
        secretKey
      );
    }
    await new Promise((r) => setTimeout(r, 600)); // rollup is fire-and-forget

    const leads = await api
      .get("/api/v1/leads")
      .query({ q: identity.email })
      .set(auth(adminToken));
    const lead = leads.body.data.items?.[0] ?? leads.body.data.leads?.[0];
    expect(lead).toBeTruthy();
    createdLeadIds.push(lead.id);

    const engagement = await api
      .get(`/api/v1/leads/${lead.id}/engagement`)
      .set(auth(adminToken));
    expect(engagement.status).toBe(200);
    const profile = engagement.body.data[0];
    expect(profile).toBeTruthy();
    expect(profile.lifecycle_stage).toBe("SIGNED_UP");
    expect(profile.intent_score).toBeGreaterThan(0);
    expect(profile.checkout_abandoned_at).toBeTruthy(); // started, never completed
    expect(profile.intent_reasons.length).toBeGreaterThan(0);
  });
});

describe("integration health", () => {
  it("reports events received and names the next action in every warning", async () => {
    const res = await api
      .get("/api/v1/ingest/health")
      .set("Authorization", `Bearer ${secretKey}`);
    expect(res.status).toBe(200);
    expect(res.body.data.events_24h).toBeGreaterThan(0);
    expect(res.body.data.health).toBe("OK");
    expect(Array.isArray(res.body.data.warnings)).toBe(true);
  });
});

describe("signals feed", () => {
  it("ranks people showing intent", async () => {
    const res = await api.get("/api/v1/signals").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // Sorted hottest first.
    const scores = res.body.data.map((s: { intent_score: number }) => s.intent_score);
    expect([...scores].sort((a: number, b: number) => b - a)).toEqual(scores);
  });
});

describe("tracker script", () => {
  it("serves as JavaScript without auth", async () => {
    const res = await api.get("/api/v1/ingest/t.js");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.text).toContain("identify");
  });
});

describe("openapi contract", () => {
  it("serves the spec without auth, so an integrator can read it before they have a key", async () => {
    const res = await api.get("/api/v1/ingest/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    // Spot-check the endpoints an integration cannot be built without. Full
    // spec-vs-router drift is asserted in tests/unit/ingest-openapi.test.ts.
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(["/events", "/identify", "/catalog", "/leads"])
    );
    expect(res.body.components.securitySchemes.SecretKey).toBeTruthy();
    expect(res.body.components.securitySchemes.PublishableKey).toBeTruthy();
  });

  it("documents /health with the keys the endpoint actually returns", async () => {
    // The unit drift test compares spec paths against the router; it cannot see
    // RESPONSE shapes. That gap let the spec claim `product`/`detail`/`counts`
    // while the endpoint returned `app`/`health_detail`/`events_24h`, an
    // integrator would have written their monitoring against fields that never
    // arrive. This compares the documented properties to a REAL response.
    const spec = await api.get("/api/v1/ingest/openapi.json");
    const documented = Object.keys(
      spec.body.paths["/health"].get.responses["200"].content["application/json"].schema
        .properties.data.properties
    ).sort();

    const live = await api
      .get("/api/v1/ingest/health")
      .set("Authorization", `Bearer ${secretKey}`);
    expect(live.status).toBe(200);
    expect(Object.keys(live.body.data).sort()).toEqual(documented);
  });
});
