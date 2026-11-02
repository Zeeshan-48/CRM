import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Kysely } from "kysely";
import { ulid } from "ulid";
import type { DB } from "../../src/db/types";
import { createMockDb, seedApp, seedLead, seedWorkspace, type MockDb, type Workspace } from "../mock-db";

// The repositories import the `db` singleton at module load, so the mock has to
// be in place before they are imported. `vi.mock` is hoisted above the imports,
// and the factory reads from a mutable holder that each test refreshes.
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

const { default: connectedAppsRepository } = await import(
  "../../src/repositories/connected-apps.repository"
);
const { default: productsRepository } = await import("../../src/repositories/products.repository");
const { default: eventDefinitionsRepository } = await import(
  "../../src/repositories/event-definitions.repository"
);
const { default: identitiesRepository } = await import(
  "../../src/repositories/identities.repository"
);
const { default: engagementRepository } = await import(
  "../../src/repositories/engagement.repository"
);
const { default: activityEventsRepository } = await import(
  "../../src/repositories/activity-events.repository"
);
const { default: dealLineItemsRepository } = await import(
  "../../src/repositories/deal-line-items.repository"
);

let mock: MockDb;
let ws: Workspace;

beforeEach(async () => {
  mock = await createMockDb();
  holder.db = mock.db;
  ws = await seedWorkspace(mock.db);
});

afterEach(async () => {
  holder.db = null;
  await mock.destroy();
});

// ---------------------------------------------------------------------------

describe("connectedAppsRepository", () => {
  it("creates and reads back an app", async () => {
    const app = await connectedAppsRepository.create({
      tenant_id: ws.tenantId,
      key: "acme",
      name: "Acme",
    });
    expect(app.status).toBe("ACTIVE");
    expect(app.health).toBe("PENDING");

    const found = await connectedAppsRepository.findByKey(ws.tenantId, "acme");
    expect(found?.id).toBe(app.id);
  });

  it("scopes every read to the tenant", async () => {
    const other = await seedWorkspace(mock.db);
    const app = await connectedAppsRepository.create({
      tenant_id: ws.tenantId,
      key: "acme",
      name: "Acme",
    });
    // The single most important property in a multi-tenant CRM: another
    // tenant's id must never resolve someone else's row.
    expect(await connectedAppsRepository.findById(app.id, other.tenantId)).toBeUndefined();
    expect(await connectedAppsRepository.findById(app.id, ws.tenantId)).toBeTruthy();
  });

  it("ensureDefaultApp is idempotent under repeat calls", async () => {
    // Two cluster workers hitting an unbound legacy key at once must not create
    // two default apps, nor throw on the unique index.
    const [a, b, c] = await Promise.all([
      connectedAppsRepository.ensureDefaultApp(ws.tenantId),
      connectedAppsRepository.ensureDefaultApp(ws.tenantId),
      connectedAppsRepository.ensureDefaultApp(ws.tenantId),
    ]);
    expect(a.id).toBe(b.id);
    expect(b.id).toBe(c.id);
    expect(await mock.db.selectFrom("connected_apps").selectAll().execute()).toHaveLength(1);
  });

  it("counts PAUSED apps against the plan limit but not DISABLED ones", async () => {
    await connectedAppsRepository.create({ tenant_id: ws.tenantId, key: "a", name: "A" });
    const paused = await connectedAppsRepository.create({ tenant_id: ws.tenantId, key: "b", name: "B" });
    const disabled = await connectedAppsRepository.create({ tenant_id: ws.tenantId, key: "c", name: "C" });
    await connectedAppsRepository.update(paused.id, ws.tenantId, { status: "PAUSED" });
    await connectedAppsRepository.update(disabled.id, ws.tenantId, { status: "DISABLED" });

    // Pausing is a temporary operational state, not a way to dodge the limit.
    expect(await connectedAppsRepository.countBillable(ws.tenantId)).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe("productsRepository", () => {
  const product = (appId: string | null, over: Record<string, unknown> = {}) => ({
    tenant_id: ws.tenantId,
    app_id: appId,
    external_id: "course_1",
    sku: null,
    name: "Advanced React",
    description: null,
    category: "Frontend",
    family: null,
    url: null,
    media: null,
    attributes: null,
    highlights: ["12 weeks"],
    status: "ACTIVE",
    source: "SYNCED",
    sort_order: 0,
    ...over,
  });

  it("round-trips JSON columns without double-encoding", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const row = await productsRepository.create(
      product(appId, { attributes: { level: "Advanced", weeks: 12 } })
    );
    const parse = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v);
    expect(parse(row.attributes)).toEqual({ level: "Advanced", weeks: 12 });
    expect(parse(row.highlights)).toEqual(["12 weeks"]);
  });

  it("hides archived products from the default listing", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    await productsRepository.create(product(appId));
    const archived = await productsRepository.create(
      product(appId, { external_id: "course_2", name: "Old" })
    );
    await productsRepository.update(archived.id, ws.tenantId, { status: "ARCHIVED" });

    const listed = await productsRepository.list(ws.tenantId);
    expect(listed.map((p) => p.name)).toEqual(["Advanced React"]);
    expect(await productsRepository.count(ws.tenantId)).toBe(1);
  });

  it("archiveMissing archives rather than deletes, keeping references alive", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const keep = await productsRepository.create(product(appId));
    const drop = await productsRepository.create(
      product(appId, { external_id: "course_2", name: "Dropped" })
    );

    const n = await productsRepository.archiveMissing(ws.tenantId, appId, [keep.id]);
    expect(n).toBe(1);

    // The row must still EXIST: deal line items and events point at it.
    const still = await productsRepository.findById(drop.id, ws.tenantId);
    expect(still?.status).toBe("ARCHIVED");
  });

  it("replacePrices swaps the whole set rather than merging", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const p = await productsRepository.create(product(appId));

    await productsRepository.replacePrices(ws.tenantId, p.id, [
      { currency: "INR", amount_minor: 499900, compare_at_minor: null, billing_period: "ONE_TIME", price_book: "STANDARD", is_default: true },
      { currency: "USD", amount_minor: 5900, compare_at_minor: null, billing_period: "ONE_TIME", price_book: "STANDARD", is_default: false },
    ]);
    expect(await productsRepository.pricesFor(ws.tenantId, [p.id])).toHaveLength(2);

    // A currency the feed stopped listing must disappear, not linger and keep
    // quoting a price the product no longer honours.
    await productsRepository.replacePrices(ws.tenantId, p.id, [
      { currency: "INR", amount_minor: 499900, compare_at_minor: null, billing_period: "ONE_TIME", price_book: "STANDARD", is_default: true },
    ]);
    const after = await productsRepository.pricesFor(ws.tenantId, [p.id]);
    expect(after).toHaveLength(1);
    expect(after[0].currency).toBe("INR");
  });

  it("consumeRedemption stops exactly at the cap", async () => {
    const offer = await productsRepository.createOffer({
      tenant_id: ws.tenantId,
      app_id: null,
      product_id: null,
      code: "CAP2",
      name: "Capped",
      description: null,
      terms: null,
      discount_type: "PERCENT",
      discount_value: 10,
      currency: null,
      applies_to: null,
      starts_at: null,
      ends_at: null,
      max_redemptions: 2,
      status: "ACTIVE",
    });

    expect(await productsRepository.consumeRedemption(offer.id, ws.tenantId)).toBe(true);
    expect(await productsRepository.consumeRedemption(offer.id, ws.tenantId)).toBe(true);
    // Third must fail: the conditional UPDATE is what stops two cluster workers
    // both slipping past a capped campaign.
    expect(await productsRepository.consumeRedemption(offer.id, ws.tenantId)).toBe(false);

    const row = await productsRepository.findOfferById(offer.id, ws.tenantId);
    expect(row?.redemptions_used).toBe(2);
  });

  it("treats a null cap as unlimited", async () => {
    const offer = await productsRepository.createOffer({
      tenant_id: ws.tenantId, app_id: null, product_id: null, code: null, name: "Open",
      description: null, terms: null, discount_type: "PERCENT", discount_value: 5,
      currency: null, applies_to: null, starts_at: null, ends_at: null,
      max_redemptions: null, status: "ACTIVE",
    });
    for (let i = 0; i < 5; i += 1) {
      expect(await productsRepository.consumeRedemption(offer.id, ws.tenantId)).toBe(true);
    }
  });

  it("deleteForApp clears the app's catalog and its offers", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const p = await productsRepository.create(product(appId));
    await productsRepository.replacePrices(ws.tenantId, p.id, [
      { currency: "INR", amount_minor: 100, compare_at_minor: null, billing_period: "ONE_TIME", price_book: "STANDARD", is_default: true },
    ]);
    await productsRepository.createOffer({
      tenant_id: ws.tenantId, app_id: appId, product_id: null, code: "X", name: "X",
      description: null, terms: null, discount_type: "PERCENT", discount_value: 5,
      currency: null, applies_to: null, starts_at: null, ends_at: null,
      max_redemptions: null, status: "ACTIVE",
    });

    await productsRepository.deleteForApp(ws.tenantId, appId);
    expect(await productsRepository.list(ws.tenantId, { appId })).toHaveLength(0);
    expect(await productsRepository.pricesFor(ws.tenantId, [p.id])).toHaveLength(0);
    expect(await productsRepository.listOffers(ws.tenantId, { appId })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("eventDefinitionsRepository", () => {
  it("autoRegister lands at NEEDS_REVIEW with zero weight", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const def = await eventDefinitionsRepository.autoRegister(
      ws.tenantId, appId, "invoice.exported", "Invoice exported"
    );
    // An unreviewed event must not move anyone's score.
    expect(def.review_status).toBe("NEEDS_REVIEW");
    expect(def.intent_weight).toBe(0);
    expect(def.auto_registered).toBe(true);
  });

  it("autoRegister is race-safe and never duplicates", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const results = await Promise.all([
      eventDefinitionsRepository.autoRegister(ws.tenantId, appId, "a.b", "A B"),
      eventDefinitionsRepository.autoRegister(ws.tenantId, appId, "a.b", "A B"),
      eventDefinitionsRepository.autoRegister(ws.tenantId, appId, "a.b", "A B"),
    ]);
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await eventDefinitionsRepository.listForApp(ws.tenantId, appId)).toHaveLength(1);
  });

  it("seedSemanticEvents is idempotent and preserves admin retuning", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    await eventDefinitionsRepository.seedSemanticEvents(ws.tenantId, appId);
    const first = await eventDefinitionsRepository.listForApp(ws.tenantId, appId);
    expect(first.length).toBeGreaterThan(10);

    const checkout = first.find((d) => d.name === "checkout.started")!;
    await eventDefinitionsRepository.update(checkout.id, ws.tenantId, { intent_weight: 5 });

    // Re-seeding (a redeploy, a second app creation path) must not stomp the
    // number an admin deliberately changed.
    await eventDefinitionsRepository.seedSemanticEvents(ws.tenantId, appId);
    const after = await eventDefinitionsRepository.findByName(ws.tenantId, appId, "checkout.started");
    expect(after?.intent_weight).toBe(5);
    expect(await eventDefinitionsRepository.listForApp(ws.tenantId, appId)).toHaveLength(first.length);
  });

  it("counts only the definitions awaiting review", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    await eventDefinitionsRepository.seedSemanticEvents(ws.tenantId, appId);
    expect(await eventDefinitionsRepository.countNeedingReview(ws.tenantId, appId)).toBe(0);
    await eventDefinitionsRepository.autoRegister(ws.tenantId, appId, "x.y", "X Y");
    expect(await eventDefinitionsRepository.countNeedingReview(ws.tenantId, appId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("identitiesRepository", () => {
  it("resolves in the caller's order, strongest evidence first", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadA = await seedLead(mock.db, ws.tenantId, { email: "a@x.test" });
    const leadB = await seedLead(mock.db, ws.tenantId, { email: "b@x.test" });

    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "EMAIL",
      identity_value: "shared@x.test", lead_id: leadB, contact_id: null,
    });
    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "EXTERNAL_USER_ID",
      identity_value: "usr_1", lead_id: leadA, contact_id: null,
    });

    const resolved = await identitiesRepository.findFirstResolved(ws.tenantId, appId, [
      { type: "EXTERNAL_USER_ID", value: "usr_1" },
      { type: "EMAIL", value: "shared@x.test" },
    ]);
    expect(resolved?.lead_id).toBe(leadA);
  });

  it("skips identities that are recorded but not yet bound", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "ANONYMOUS_ID",
      identity_value: "anon_1", lead_id: null, contact_id: null,
    });
    const resolved = await identitiesRepository.findFirstResolved(ws.tenantId, appId, [
      { type: "ANONYMOUS_ID", value: "anon_1" },
    ]);
    expect(resolved).toBeUndefined();
  });

  it("upsert never CLEARS a binding an earlier call established", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);

    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "EMAIL",
      identity_value: "a@x.test", lead_id: leadId, contact_id: null,
    });
    // A later anonymous page view arrives with no lead id. The COALESCE in the
    // upsert is what stops it unbinding a known person.
    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "EMAIL",
      identity_value: "a@x.test", lead_id: null, contact_id: null,
    });

    const row = await identitiesRepository.find(ws.tenantId, appId, "EMAIL", "a@x.test");
    expect(row?.lead_id).toBe(leadId);
  });

  it("bindAnonymous claims the visitor for a person", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);
    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "ANONYMOUS_ID",
      identity_value: "anon_9", lead_id: null, contact_id: null,
    });

    await identitiesRepository.bindAnonymous(ws.tenantId, appId, "anon_9", {
      leadId, contactId: null,
    });
    const row = await identitiesRepository.find(ws.tenantId, appId, "ANONYMOUS_ID", "anon_9");
    expect(row?.lead_id).toBe(leadId);
  });

  it("deleteForPerson leaves no identity pointing at a removed lead", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);
    await identitiesRepository.upsert({
      tenant_id: ws.tenantId, app_id: appId, identity_type: "EMAIL",
      identity_value: "a@x.test", lead_id: leadId, contact_id: null,
    });

    await identitiesRepository.deleteForPerson(ws.tenantId, { leadId });
    // The bug this guards: an identity surviving its lead makes every later
    // event resolve to a record that no longer exists, invisibly.
    expect(await identitiesRepository.listForPerson(ws.tenantId, { leadId })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("engagementRepository", () => {
  it("ensure is idempotent for the same person and app", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);
    const a = await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });
    const b = await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });
    expect(a.id).toBe(b.id);
    expect(await mock.db.selectFrom("engagement_profiles").selectAll().execute()).toHaveLength(1);
  });

  it("keeps one profile per app, so products never average together", async () => {
    const appA = await seedApp(mock.db, ws.tenantId, { key: "a" });
    const appB = await seedApp(mock.db, ws.tenantId, { key: "b" });
    const leadId = await seedLead(mock.db, ws.tenantId);
    await engagementRepository.ensure(ws.tenantId, appA, { leadId, contactId: null });
    await engagementRepository.ensure(ws.tenantId, appB, { leadId, contactId: null });
    expect(await engagementRepository.listForPerson(ws.tenantId, { leadId, contactId: null })).toHaveLength(2);
  });

  it("touchSeen moves last_seen forward only and first_seen backward only", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);
    const p = await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });

    // ensure() stamps both timestamps with the CURRENT time, so the baseline has
    // to be set explicitly or "later" and "earlier" are measured against now.
    const base = new Date("2026-03-01T00:00:00Z");
    await engagementRepository.update(p.id, ws.tenantId, {
      first_seen_at: base,
      last_seen_at: base,
    });

    const later = new Date("2026-06-01T00:00:00Z");
    const earlier = new Date("2026-01-01T00:00:00Z");

    await engagementRepository.touchSeen(p.id, later);
    // An out-of-order replay (a queue flush, a retried webhook) must not make an
    // active lead look dormant by writing an old timestamp last.
    await engagementRepository.touchSeen(p.id, earlier);

    const row = await engagementRepository.find(ws.tenantId, appId, { leadId, contactId: null });
    expect(new Date(row!.last_seen_at!).getTime()).toBe(later.getTime());
    // first_seen only ever reaches further back.
    expect(new Date(row!.first_seen_at!).getTime()).toBe(earlier.getTime());
  });

  it("signals exclude zero-score profiles and rank hottest first", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const cold = await seedLead(mock.db, ws.tenantId, { email: "cold@x.test" });
    const warm = await seedLead(mock.db, ws.tenantId, { email: "warm@x.test" });
    const hot = await seedLead(mock.db, ws.tenantId, { email: "hot@x.test" });

    for (const [leadId, score, band] of [[cold, 0, "COLD"], [warm, 50, "WARM"], [hot, 90, "HOT"]] as const) {
      const p = await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });
      await engagementRepository.update(p.id, ws.tenantId, { intent_score: score, intent_band: band });
    }

    const signals = await engagementRepository.listSignals(ws.tenantId, {});
    expect(signals.map((s) => s.intent_score)).toEqual([90, 50]);
  });

  it("movePerson carries the profile onto a converted contact", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const leadId = await seedLead(mock.db, ws.tenantId);
    await engagementRepository.ensure(ws.tenantId, appId, { leadId, contactId: null });

    const contactId = ulid();
    await mock.db.insertInto("contacts").values({
      id: contactId, tenant_id: ws.tenantId, name: "C", lifecycle: "PROSPECT",
      created_at: new Date(), updated_at: new Date(),
    }).execute();

    expect(await engagementRepository.movePerson(ws.tenantId, leadId, contactId)).toBe(1);
    const carried = await engagementRepository.listForPerson(ws.tenantId, { leadId: null, contactId });
    expect(carried).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe("activityEventsRepository", () => {
  const insert = (over: Record<string, unknown> = {}) =>
    activityEventsRepository.insertEvent({
      tenant_id: ws.tenantId,
      api_key_id: null,
      lead_id: null,
      event: "page.viewed",
      title: null,
      status: "RECORDED",
      occurred_at: new Date(),
      idempotency_key: ulid(),
      payload: null,
      error: null,
      ...over,
    });

  it("stores the product-integration columns", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    const row = await insert({
      app_id: appId, anonymous_id: "anon_1", session_id: "s1",
      page_url: "https://x.test/p", value_minor: 1000, currency: "INR",
    });
    expect(row.app_id).toBe(appId);
    expect(row.anonymous_id).toBe("anon_1");
    expect(row.value_minor).toBe(1000);
  });

  it("rejects a duplicate idempotency key at the database level", async () => {
    const key = "dup-1";
    await insert({ idempotency_key: key });
    // The unique index is the real guard against a producer redelivering.
    await expect(insert({ idempotency_key: key })).rejects.toThrow();
  });

  it("findExistingKeys answers a whole batch in one call", async () => {
    await insert({ idempotency_key: "a" });
    await insert({ idempotency_key: "b" });
    const seen = await activityEventsRepository.findExistingKeys(ws.tenantId, ["a", "b", "c"]);
    expect(seen.has("a")).toBe(true);
    expect(seen.has("c")).toBe(false);
  });

  it("listForPerson follows the person across conversion", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    const contactId = ulid();
    await mock.db.insertInto("contacts").values({
      id: contactId, tenant_id: ws.tenantId, name: "C", lifecycle: "PROSPECT",
      created_at: new Date(), updated_at: new Date(),
    }).execute();

    await insert({ lead_id: leadId });
    await insert({ contact_id: contactId });

    const both = await activityEventsRepository.listForPerson(ws.tenantId, { leadId, contactId });
    expect(both).toHaveLength(2);
  });

  it("touchLeadActivity only ever moves the stamp forward", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    const late = new Date("2026-06-01T00:00:00Z");
    const early = new Date("2026-01-01T00:00:00Z");
    await activityEventsRepository.touchLeadActivity(ws.tenantId, leadId, late);
    await activityEventsRepository.touchLeadActivity(ws.tenantId, leadId, early);
    const lead = await mock.db.selectFrom("leads").select("last_activity_at").where("id", "=", leadId).executeTakeFirstOrThrow();
    expect(new Date(lead.last_activity_at!).getTime()).toBe(late.getTime());
  });

  it("healthCounts buckets by status", async () => {
    const appId = await seedApp(mock.db, ws.tenantId);
    await insert({ app_id: appId, status: "RECORDED" });
    await insert({ app_id: appId, status: "ORPHAN" });
    await insert({ app_id: appId, status: "REJECTED" });
    const counts = await activityEventsRepository.healthCounts(
      ws.tenantId, appId, new Date(Date.now() - 86_400_000)
    );
    expect(counts).toEqual({ total: 3, orphaned: 1, rejected: 1 });
  });

  it("deleteForPerson removes a deleted lead's whole stream", async () => {
    const leadId = await seedLead(mock.db, ws.tenantId);
    await insert({ lead_id: leadId });
    await insert({ lead_id: leadId });
    await activityEventsRepository.deleteForPerson(ws.tenantId, { leadId });
    expect(await activityEventsRepository.listForPerson(ws.tenantId, { leadId })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe("dealLineItemsRepository", () => {
  const seedDeal = async (): Promise<string> => {
    const id = ulid();
    const now = new Date();
    await mock.db.insertInto("deals").values({
      id, tenant_id: ws.tenantId, pipeline_id: ws.pipelineId, stage_id: ws.stageId,
      title: "Deal", value: 0, currency: "INR", status: "OPEN",
      win_probability: 0, health_score: 0, created_at: now, updated_at: now,
    }).execute();
    return id;
  };

  it("stores a line and reads it back in order", async () => {
    const dealId = await seedDeal();
    await dealLineItemsRepository.create({
      tenant_id: ws.tenantId, deal_id: dealId, product_id: null, offer_id: null,
      name: "B", quantity: 1, unit_price_minor: 100, discount_minor: 0,
      total_minor: 100, currency: "INR", sort_order: 2,
    });
    await dealLineItemsRepository.create({
      tenant_id: ws.tenantId, deal_id: dealId, product_id: null, offer_id: null,
      name: "A", quantity: 1, unit_price_minor: 100, discount_minor: 0,
      total_minor: 100, currency: "INR", sort_order: 1,
    });
    const items = await dealLineItemsRepository.listForDeal(ws.tenantId, dealId);
    expect(items.map((i) => i.name)).toEqual(["A", "B"]);
  });

  it("revenueByProduct counts only WON deals", async () => {
    const won = await seedDeal();
    const open = await seedDeal();
    await mock.db.updateTable("deals").set({ status: "WON", closed_at: new Date() })
      .where("id", "=", won).execute();

    for (const dealId of [won, open]) {
      await dealLineItemsRepository.create({
        tenant_id: ws.tenantId, deal_id: dealId, product_id: null, offer_id: null,
        name: "Course", quantity: 2, unit_price_minor: 50000, discount_minor: 0,
        total_minor: 100000, currency: "INR", sort_order: 0,
      });
    }

    const revenue = await dealLineItemsRepository.revenueByProduct(ws.tenantId);
    expect(revenue).toHaveLength(1);
    expect(revenue[0].revenue_minor).toBe(100000);
    expect(revenue[0].units).toBe(2);
  });
});
