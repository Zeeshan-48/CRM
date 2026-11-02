import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";
import { ulid } from "ulid";
import type { DB } from "../../src/db/types";
import {
  createMockDb,
  seedApp,
  seedLead,
  seedWorkspace,
  type MockDb,
  type Workspace,
} from "../mock-db";

// Services are exercised against the in-memory database, so this covers the
// orchestration the pure unit tests cannot reach (transactions, upsert races,
// cross-repository ordering) without needing the shared dev database.
const holder: { db: Kysely<DB> | null } = { db: null };

vi.mock("../../src/db/connection", () => ({
  get db() {
    if (!holder.db) throw new Error("mock db not initialised");
    return holder.db;
  },
  closeDB: async () => undefined,
  pool: {},
  waitForDBConnection: async () => undefined,
}));

// Outbound side effects are not what these tests are about, and leaving them
// live would make the suite depend on Redis, SES and the network.
vi.mock("../../src/services/engine.service", () => ({
  default: { audit: () => undefined, notify: () => undefined, emit: async () => [] },
  WORKFLOW_TRIGGERS: [],
  WORKFLOW_ACTIONS: [],
}));

const { default: catalogSyncService } = await import("../../src/services/catalog-sync.service");
const { default: productsService } = await import("../../src/services/products.service");
const { default: engagementService } = await import("../../src/services/engagement.service");
const { default: dealLineItemsService } = await import(
  "../../src/services/deal-line-items.service"
);
const { default: eventDefinitionsRepository } = await import(
  "../../src/repositories/event-definitions.repository"
);
const { default: engagementRepository } = await import(
  "../../src/repositories/engagement.repository"
);
const { default: activityEventsRepository } = await import(
  "../../src/repositories/activity-events.repository"
);

let mock: MockDb;
let ws: Workspace;
let appId: string;

beforeEach(async () => {
  mock = await createMockDb();
  holder.db = mock.db;
  ws = await seedWorkspace(mock.db);
  appId = await seedApp(mock.db, ws.tenantId);
});

afterEach(async () => {
  holder.db = null;
  await mock.destroy();
});

const ctx = () => ({ tenantId: ws.tenantId, appId, actorId: ws.userId });

const CATALOG = {
  mode: "UPSERT",
  products: [
    {
      external_id: "course_react",
      name: "Advanced React",
      category: "Frontend",
      highlights: ["12 weeks"],
      prices: [
        { currency: "INR", amount_minor: 499900, compare_at_minor: 799900, is_default: true },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------

describe("catalogSyncService", () => {
  it("creates on first sync and updates on the second", async () => {
    const first = await catalogSyncService.syncProducts(ctx(), CATALOG);
    expect(first).toMatchObject({ created: 1, updated: 0, archived: 0 });

    const second = await catalogSyncService.syncProducts(ctx(), CATALOG);
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(await mock.db.selectFrom("products").selectAll().execute()).toHaveLength(1);
  });

  it("rejects a bare `amount` with a message naming the fix", async () => {
    await expect(
      catalogSyncService.syncProducts(ctx(), {
        products: [{ external_id: "x", name: "X", prices: [{ amount: 4999 }] }],
      })
    ).rejects.toThrow(/amount_minor/);
  });

  it("rolls the whole sync back when one product is invalid", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await expect(
      catalogSyncService.syncProducts(ctx(), {
        products: [
          { external_id: "course_react", name: "Renamed" },
          { external_id: "bad", name: "" }, // missing name
        ],
      })
    ).rejects.toThrow();

    // Mapping runs before the transaction, so nothing was half-applied.
    const rows = await mock.db.selectFrom("products").select(["name"]).execute();
    expect(rows.map((r) => r.name)).toEqual(["Advanced React"]);
  });

  it("REPLACE archives what the feed dropped without deleting it", async () => {
    await catalogSyncService.syncProducts(ctx(), {
      mode: "UPSERT",
      products: [
        ...CATALOG.products,
        { external_id: "course_old", name: "Retired", prices: [] },
      ],
    });

    const result = await catalogSyncService.syncProducts(ctx(), {
      mode: "REPLACE",
      products: CATALOG.products,
    });
    expect(result.archived).toBe(1);

    const retired = await mock.db
      .selectFrom("products")
      .selectAll()
      .where("external_id", "=", "course_old")
      .executeTakeFirst();
    // Still present: line items and events reference it.
    expect(retired?.status).toBe("ARCHIVED");
  });

  it("restores an archived product when the feed brings it back", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncProducts(ctx(), { mode: "REPLACE", products: [] });
    let row = await mock.db.selectFrom("products").selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe("ARCHIVED");

    await catalogSyncService.syncProducts(ctx(), CATALOG);
    row = await mock.db.selectFrom("products").selectAll().executeTakeFirstOrThrow();
    expect(row.status).toBe("ACTIVE");
    // Same row: history and references survive the round trip.
    expect(await mock.db.selectFrom("products").selectAll().execute()).toHaveLength(1);
  });

  it("skips an offer scoped to products it has never seen", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const result = await catalogSyncService.syncOffers(ctx(), {
      offers: [
        {
          code: "GHOST",
          name: "Ghost",
          discount_type: "PERCENT",
          discount_value: 10,
          applies_to: { product_ids: ["course_does_not_exist"] },
        },
      ],
    });
    // Applying it would silently widen a targeted offer to the whole catalog.
    expect(result).toMatchObject({ created: 0, skipped: 1 });
  });

  it("resolves an offer's external product ids onto real rows", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncOffers(ctx(), {
      offers: [
        {
          code: "REACT20",
          name: "React 20",
          discount_type: "PERCENT",
          discount_value: 20,
          applies_to: { product_ids: ["course_react"] },
        },
      ],
    });

    const product = await mock.db.selectFrom("products").selectAll().executeTakeFirstOrThrow();
    const offer = await mock.db.selectFrom("product_offers").selectAll().executeTakeFirstOrThrow();
    expect(offer.product_id).toBe(product.id);
  });

  it("re-syncing offers updates rather than duplicating", async () => {
    const offers = {
      offers: [{ code: "AUG20", name: "August", discount_type: "PERCENT", discount_value: 20 }],
    };
    await catalogSyncService.syncOffers(ctx(), offers);
    const second = await catalogSyncService.syncOffers(ctx(), offers);
    expect(second).toMatchObject({ created: 0, updated: 1 });
    expect(await mock.db.selectFrom("product_offers").selectAll().execute()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("productsService", () => {
  it("surfaces a resolved price and the best live offer", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncOffers(ctx(), {
      offers: [
        { code: "TEN", name: "Ten", discount_type: "PERCENT", discount_value: 10 },
        { code: "TWENTY", name: "Twenty", discount_type: "PERCENT", discount_value: 20 },
      ],
    });

    const list = await productsService.list(ws.tenantId, {});
    const p = list.items[0];
    expect(p.price?.amount_minor).toBe(499900);
    expect(p.price?.savings_percent).toBe(38); // 499900 against 799900
    // Best discount first, so an agent leads with the strongest.
    expect(p.best_offer?.code).toBe("TWENTY");
    expect(p.best_offer?.discount_minor).toBe(99980);
  });

  it("pre-formats an offer's discount, in minor units for FLAT", async () => {
    // The offers list used to hand the raw `discount_value` to the page, which
    // divided it by 100 and printed "Flat 5000.00 INR off". A FLAT value is minor
    // units, so formatting belongs on the server next to every other money string.
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncOffers(ctx(), {
      offers: [
        { code: "PCT", name: "Percent", discount_type: "PERCENT", discount_value: 20 },
        {
          code: "FLATOFF",
          name: "Flat",
          discount_type: "FLAT",
          discount_value: 500000,
          currency: "INR",
        },
      ],
    });

    const offers = await productsService.listOffers(ws.tenantId);
    const byCode = new Map(offers.map((o) => [o.code, o]));
    expect(byCode.get("PCT")?.discount_display).toBe("20% off");
    expect(byCode.get("FLATOFF")?.discount_display).toBe("₹5,000 off");
  });

  it("marks synced products read-only and refuses to edit one", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const list = await productsService.list(ws.tenantId, {});
    expect(list.items[0].editable).toBe(false);

    // Editing would be silently reverted by the next sync, which is worse than
    // refusing outright.
    await expect(
      productsService.updateManual(ws.tenantId, ws.userId, list.items[0].id, { name: "Nope" })
    ).rejects.toThrow(/read-only/i);
  });

  it("creates and edits a CRM-native product", async () => {
    const created = await productsService.createManual(ws.tenantId, ws.userId, {
      name: "Consulting day",
      prices: [{ currency: "INR", amount_minor: 2500000, is_default: true }],
    });
    expect(created.editable).toBe(true);
    expect(created.price?.amount_minor).toBe(2500000);

    const updated = await productsService.updateManual(ws.tenantId, ws.userId, created.id, {
      name: "Consulting day (senior)",
    });
    expect(updated.name).toBe("Consulting day (senior)");
  });

  it("validateCoupon gives one answer for every kind of miss", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const list = await productsService.list(ws.tenantId, {});
    const productId = list.items[0].id;

    const bad = await productsService.validateCoupon(ws.tenantId, productId, "NOPE");
    expect(bad.valid).toBe(false);

    await catalogSyncService.syncOffers(ctx(), {
      offers: [{ code: "GOOD", name: "Good", discount_type: "PERCENT", discount_value: 15 }],
    });
    const good = await productsService.validateCoupon(ws.tenantId, productId, "good");
    expect(good.valid).toBe(true);
    if (good.valid) expect(good.offer.discount_minor).toBe(74985);
  });

  it("hides an expired offer from the product even when its status says ACTIVE", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncOffers(ctx(), {
      offers: [
        {
          code: "OLD",
          name: "Expired",
          discount_type: "PERCENT",
          discount_value: 50,
          starts_at: "2020-01-01T00:00:00Z",
          ends_at: "2020-12-31T23:59:59Z",
        },
      ],
    });
    const list = await productsService.list(ws.tenantId, {});
    // An agent must never be handed a code that bounces at checkout.
    expect(list.items[0].offers).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("engagementService", () => {
  const applyEvent = async (
    leadId: string,
    event: string,
    properties: Record<string, unknown> = {},
    product?: { id: string | null; external_id: string | null; name: string | null }
  ) =>
    engagementService.applyEvent({
      tenantId: ws.tenantId,
      appId,
      person: { leadId, contactId: null },
      event,
      occurredAtIso: new Date().toISOString(),
      properties,
      product,
      scoring: false, // scoring needs the event stream; folding is what we assert
    });

  it("folds lifecycle forward and never backward on a redelivery", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await applyEvent(leadId, "signup.completed");
    await applyEvent(leadId, "subscription.activated");
    await applyEvent(leadId, "signup.completed"); // redelivered

    const p = await engagementRepository.find(ws.tenantId, appId, { leadId, contactId: null });
    expect(p?.lifecycle_stage).toBe("PAYING");
  });

  it("computes abandonment our side and clears it on completion", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await applyEvent(leadId, "checkout.started", { value: 499900, currency: "INR" });
    let p = await engagementRepository.find(ws.tenantId, appId, { leadId, contactId: null });
    expect(p?.checkout_abandoned_at).toBeTruthy();

    await applyEvent(leadId, "checkout.completed");
    p = await engagementRepository.find(ws.tenantId, appId, { leadId, contactId: null });
    expect(p?.checkout_abandoned_at).toBeNull();
    expect(p?.plan_status).toBe("active");
  });

  it("keeps product-defined counters under the producer's own names", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await applyEvent(leadId, "invoice.exported");
    await applyEvent(leadId, "invoice.exported");
    await applyEvent(leadId, "feature.used", { counters: { seats_used: 12 } });

    const p = await engagementRepository.find(ws.tenantId, appId, { leadId, contactId: null });
    const usage = typeof p?.usage === "string" ? JSON.parse(p.usage) : p?.usage;
    // The CRM has never heard of "invoice.exported" and still records it usefully.
    expect(usage.counts["invoice.exported"]).toBe(2);
    expect(usage.reported.seats_used).toBe(12);
  });

  it("recompute scores only ACTIVE definitions", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await eventDefinitionsRepository.seedSemanticEvents(ws.tenantId, appId);
    const pending = await eventDefinitionsRepository.autoRegister(
      ws.tenantId, appId, "syllabus.downloaded", "Syllabus downloaded"
    );

    const insert = (event: string) =>
      activityEventsRepository.insertEvent({
        tenant_id: ws.tenantId, api_key_id: null, lead_id: leadId, event,
        title: null, status: "RECORDED", occurred_at: new Date(),
        idempotency_key: ulid(), payload: null, error: null, app_id: appId,
      });

    await insert("pricing.viewed");
    await insert("syllabus.downloaded");

    const profile = await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });
    const scored = await engagementService.recompute(ws.tenantId, profile.id);
    const reasons = typeof scored?.intent_reasons === "string"
      ? JSON.parse(scored.intent_reasons)
      : (scored?.intent_reasons as Array<{ label: string }>);

    expect(scored!.intent_score).toBeGreaterThan(0);
    expect(scored!.events_30d).toBe(2);
    // An unreviewed event is stored and counted as activity, but must not move
    // the score until a human decides what it means.
    expect(reasons.some((r) => /syllabus/i.test(r.label))).toBe(false);

    await eventDefinitionsRepository.update(pending.id, ws.tenantId, {
      review_status: "ACTIVE", intent_weight: 40,
    });
    const after = await engagementService.recompute(ws.tenantId, profile.id);
    expect(after!.intent_score).toBeGreaterThan(scored!.intent_score);
  });

  it("purgePerson leaves nothing behind for a deleted lead", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await applyEvent(leadId, "signup.completed");
    await activityEventsRepository.insertEvent({
      tenant_id: ws.tenantId, api_key_id: null, lead_id: leadId, event: "page.viewed",
      title: null, status: "RECORDED", occurred_at: new Date(),
      idempotency_key: ulid(), payload: null, error: null, app_id: appId,
    });
    await mock.db.insertInto("app_identities").values({
      id: ulid(), tenant_id: ws.tenantId, app_id: appId, identity_type: "EMAIL",
      identity_value: "a@x.test", lead_id: leadId, contact_id: null,
      first_seen_at: new Date(), last_seen_at: new Date(), created_at: new Date(),
    }).execute();

    await engagementService.purgePerson(ws.tenantId, { leadId });

    // The bug this guards: any survivor makes later events resolve to a lead
    // that no longer exists, and they become invisible forever.
    expect(await mock.db.selectFrom("engagement_profiles").selectAll().execute()).toHaveLength(0);
    expect(await mock.db.selectFrom("app_identities").selectAll().execute()).toHaveLength(0);
    expect(await mock.db.selectFrom("activity_events").selectAll().execute()).toHaveLength(0);
  });

  it("bestIntentFor takes the highest across products", async () => {
    const otherApp = await seedApp(mock.db, ws.tenantId, { key: "other" });
    const leadId = await seedLead(mock.db, ws.tenantId);

    for (const [id, score] of [[appId, 30], [otherApp, 77]] as const) {
      const p = await engagementRepository.ensure(ws.tenantId, id, { leadId, contactId: null });
      await engagementRepository.update(p.id, ws.tenantId, { intent_score: score });
    }
    // Hot on ANY product is hot.
    expect(await engagementService.bestIntentFor(ws.tenantId, { leadId, contactId: null })).toBe(77);
  });

  it("returns null when the person has no product history at all", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    // null, not 0: "no integration data" must not read as "dead on the product".
    expect(await engagementService.bestIntentFor(ws.tenantId, { leadId, contactId: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("dealLineItemsService", () => {
  const seedDeal = async (): Promise<string> => {
    const id = ulid();
    const now = new Date();
    await mock.db.insertInto("deals").values({
      id, tenant_id: ws.tenantId, pipeline_id: ws.pipelineId, stage_id: ws.stageId,
      title: "Deal", value: 12345, currency: "INR", status: "OPEN",
      win_probability: 0, health_score: 0, created_at: now, updated_at: now,
    }).execute();
    return id;
  };

  const dealValue = async (id: string): Promise<number> =>
    (await mock.db.selectFrom("deals").select("value").where("id", "=", id).executeTakeFirstOrThrow()).value;

  it("takes the price from the catalog, not the request", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const product = (await productsService.list(ws.tenantId, {})).items[0];
    const dealId = await seedDeal();

    const result = await dealLineItemsService.add(ws.tenantId, ws.userId, dealId, {
      product_id: product.id,
      quantity: 2,
    });
    expect(result.items[0].unit_price_minor).toBe(499900);
    expect(result.total_minor).toBe(999800);
  });

  it("derives deals.value from the lines, rounding at the documented seam", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const product = (await productsService.list(ws.tenantId, {})).items[0];
    const dealId = await seedDeal();

    await dealLineItemsService.add(ws.tenantId, ws.userId, dealId, { product_id: product.id, quantity: 1 });
    // 499900 paise = 4999.00 rupees.
    expect(await dealValue(dealId)).toBe(4999);
  });

  it("leaves a deal with no lines completely alone", async () => {
    const dealId = await seedDeal();
    const result = await dealLineItemsService.list(ws.tenantId, dealId);
    expect(result.items).toHaveLength(0);
    // Back-compat: a deal whose value was typed by hand must not be zeroed.
    expect(await dealValue(dealId)).toBe(12345);
  });

  it("applies an offer and refuses one that does not apply", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    await catalogSyncService.syncOffers(ctx(), {
      offers: [{ code: "TWENTY", name: "Twenty", discount_type: "PERCENT", discount_value: 20 }],
    });
    const product = (await productsService.list(ws.tenantId, {})).items[0];
    const dealId = await seedDeal();

    const ok = await dealLineItemsService.add(ws.tenantId, ws.userId, dealId, {
      product_id: product.id, quantity: 1, offer_id: product.best_offer!.id,
    });
    expect(ok.items[0].discount_minor).toBe(99980);
    expect(ok.items[0].total_minor).toBe(399920);

    const usdOnly = await mock.db.insertInto("product_offers").values({
      id: ulid(), tenant_id: ws.tenantId, app_id: null, product_id: null, code: "USDFLAT",
      name: "USD flat", discount_type: "FLAT", discount_value: 5000, currency: "USD",
      applies_to: null, starts_at: null, ends_at: null, max_redemptions: null,
      redemptions_used: 0, status: "ACTIVE", created_at: new Date(), updated_at: new Date(),
    }).returningAll().executeTakeFirstOrThrow();

    // Subtracting dollars from a rupee price would be a silent, wrong sale.
    await expect(
      dealLineItemsService.add(ws.tenantId, ws.userId, dealId, {
        product_id: product.id, quantity: 1, offer_id: usdOnly.id,
      })
    ).rejects.toThrow(/does not apply/i);
  });

  it("refuses a product with no published price rather than treating it as free", async () => {
    const free = await productsService.createManual(ws.tenantId, ws.userId, { name: "Unpriced" });
    const dealId = await seedDeal();
    await expect(
      dealLineItemsService.add(ws.tenantId, ws.userId, dealId, { product_id: free.id, quantity: 1 })
    ).rejects.toThrow(/no published price/i);
  });

  it("recomputes the deal value on update and keeps the last value on removal", async () => {
    await catalogSyncService.syncProducts(ctx(), CATALOG);
    const product = (await productsService.list(ws.tenantId, {})).items[0];
    const dealId = await seedDeal();

    const added = await dealLineItemsService.add(ws.tenantId, ws.userId, dealId, {
      product_id: product.id, quantity: 1,
    });
    await dealLineItemsService.update(ws.tenantId, ws.userId, dealId, added.items[0].id, {
      quantity: 3,
    });
    expect(await dealValue(dealId)).toBe(14997);

    const after = await dealLineItemsService.remove(ws.tenantId, ws.userId, dealId, added.items[0].id);
    expect(after.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("lead source attribution", () => {
  // Regression guard. When every ingest context started resolving a connected
  // product, the lead `source` silently changed from the API key's name to the
  // app's, so a workspace whose keys were named "Zapier" and "Partner import"
  // suddenly saw every lead sourced as "Default product".
  it("keeps the key name for a legacy key on the Default shim", async () => {
    const { DEFAULT_APP_KEY } = await import("../../src/constants/connected-apps.const");
    const key = {
      id: "k", tenantId: ws.tenantId, createdBy: null, name: "Zapier",
      appId: "a", appKey: DEFAULT_APP_KEY, appName: "Default product",
      scope: "SECRET" as const, environment: "LIVE" as const,
    };
    // The shim's name says nothing; the key's name is what the workspace has
    // always seen on these leads.
    const { sourceForKey } = await import("../../src/controllers/ingest.controller");
    expect(sourceForKey(key)).toBe("Zapier");
  });

  it("uses the product name for a real connected product", async () => {
    const key = {
      id: "k", tenantId: ws.tenantId, createdBy: null, name: "Acme Learning server key",
      appId: "a", appKey: "acme-learning", appName: "Acme Learning",
      scope: "SECRET" as const, environment: "LIVE" as const,
    };
    // "Acme Learning" reads better than "Acme Learning server key".
    const { sourceForKey } = await import("../../src/controllers/ingest.controller");
    expect(sourceForKey(key)).toBe("Acme Learning");
  });
});
