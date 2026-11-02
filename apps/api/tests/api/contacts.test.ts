import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, login } from "../helpers";

// Unique marker so assertions never collide with seeded or concurrent data.
const MARK = "CtcZx91";

let adminToken: string;
let financeToken: string;
let esAdminToken: string;
const createdContactIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  if (createdContactIds.length) {
    await db.deleteFrom("contacts").where("id", "in", createdContactIds).execute();
  }
  await closeDB();
});

describe("contacts module", () => {
  it("lists seeded contacts", async () => {
    const res = await api.get("/api/v1/contacts").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(8);
    expect(res.body.data[0].lifecycle).toBeDefined();
    expect(res.body.data[0].name).toBeTruthy();
  });

  it("filters by lifecycle", async () => {
    const res = await api.get("/api/v1/contacts?lifecycle=CUSTOMER").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.every((c: { lifecycle: string }) => c.lifecycle === "CUSTOMER")).toBe(
      true
    );
  });

  it("rejects an invalid lifecycle filter", async () => {
    const res = await api.get("/api/v1/contacts?lifecycle=BOGUS").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("creates a contact with defaults and requires a name", async () => {
    const missing = await api
      .post("/api/v1/contacts")
      .set(auth(adminToken))
      .send({ email: "noname@example.com" });
    expect(missing.status).toBe(400);

    const res = await api.post("/api/v1/contacts").set(auth(adminToken)).send({
      name: `${MARK} Person`,
      email: `${MARK.toLowerCase()}@example.com`,
      phone: "+919998877661",
      company: `${MARK} Industries`,
    });
    expect(res.status).toBe(201);
    const contact = res.body.data;
    createdContactIds.push(contact.id);
    expect(contact.lifecycle).toBe("LEAD");
    expect(contact.owner_id).toBeTruthy();
    expect(contact.tags).toEqual([]);
    expect(contact.last_activity_at).toBeTruthy();
  });

  it("searches q across name, email, phone and company", async () => {
    const companyOnly = await api.post("/api/v1/contacts").set(auth(adminToken)).send({
      name: "Plain Name",
      company: `${MARK} Industries`,
    });
    expect(companyOnly.status).toBe(201);
    createdContactIds.push(companyOnly.body.data.id);

    const byMark = await api.get(`/api/v1/contacts?q=${MARK}`).set(auth(adminToken));
    expect(byMark.status).toBe(200);
    // Matches the first contact by name/email and the second by company.
    expect(byMark.body.data.length).toBe(2);

    const byPhone = await api.get("/api/v1/contacts?q=9998877661").set(auth(adminToken));
    expect(byPhone.body.data.length).toBe(1);
    expect(byPhone.body.data[0].name).toBe(`${MARK} Person`);

    const byEmail = await api
      .get(`/api/v1/contacts?q=${MARK.toLowerCase()}@example`)
      .set(auth(adminToken));
    expect(byEmail.body.data.length).toBe(1);
  });

  it("returns the 360 profile with relations and a sorted timeline", async () => {
    // A seeded contact with a deal, so every relation has something to show.
    const nwTenant = await db
      .selectFrom("tenants")
      .select(["id"])
      .where("slug", "=", "northwind")
      .executeTakeFirstOrThrow();
    const withDeal = await db
      .selectFrom("deals")
      .select(["contact_id"])
      .where("tenant_id", "=", nwTenant.id)
      .where("contact_id", "is not", null)
      .executeTakeFirst();
    expect(withDeal).toBeTruthy();

    const res = await api
      .get(`/api/v1/contacts/${withDeal!.contact_id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    const profile = res.body.data;

    for (const key of [
      "activities",
      "tickets",
      "conversations",
      "messages",
      "deals",
      "invoices",
      "calls",
      "meetings",
      "timeline",
    ]) {
      expect(Array.isArray(profile[key]), `${key} should be an array`).toBe(true);
    }

    expect(profile.deals.length).toBeGreaterThanOrEqual(1);

    expect(profile.timeline.length).toBeGreaterThanOrEqual(1);
    for (const item of profile.timeline) {
      // `product` = something the person did in a connected product. It is folded
      // into the same timeline as the CRM touches on purpose, so an agent reads one
      // chronological story instead of correlating two lists by eye.
      expect(["activity", "message", "call", "meeting", "ticket", "product"]).toContain(
        item.kind
      );
      expect(item.at).toBeTruthy();
    }
    for (let i = 1; i < profile.timeline.length; i++) {
      const prev = new Date(profile.timeline[i - 1].at).getTime();
      const curr = new Date(profile.timeline[i].at).getTime();
      expect(prev).toBeGreaterThanOrEqual(curr);
    }
  });

  it("folds product activity into the same timeline as CRM touches", async () => {
    // Find a contact that has product events, then assert they arrive interleaved
    // in the one timeline rather than being served as a separate list. Permitting
    // the `product` kind above is not the same as proving it is actually merged.
    const nwTenant = await db
      .selectFrom("tenants")
      .select(["id"])
      .where("slug", "=", "northwind")
      .executeTakeFirstOrThrow();
    const withEvents = await db
      .selectFrom("activity_events")
      .select(["contact_id"])
      .where("tenant_id", "=", nwTenant.id)
      .where("contact_id", "is not", null)
      .where("status", "=", "RECORDED")
      .executeTakeFirst();
    expect(withEvents?.contact_id, "seed should give a contact product events").toBeTruthy();

    const res = await api
      .get(`/api/v1/contacts/${withEvents!.contact_id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);

    const timeline = res.body.data.timeline as Array<{ kind: string; label: string | null }>;
    const productItems = timeline.filter((i) => i.kind === "product");
    expect(productItems.length).toBeGreaterThanOrEqual(1);
    // Labelled from the product's own event definition, so a CRM that has never
    // heard of this product still renders something a human can read.
    expect(productItems[0].label).toBeTruthy();
    // And still one sorted stream, not product rows appended at the end.
    for (let i = 1; i < timeline.length; i++) {
      expect(new Date(timeline[i - 1].at).getTime()).toBeGreaterThanOrEqual(
        new Date(timeline[i].at).getTime()
      );
    }
  });

  it("updates a contact and validates lifecycle", async () => {
    const created = await api
      .post("/api/v1/contacts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Updatable` });
    createdContactIds.push(created.body.data.id);

    const invalid = await api
      .put(`/api/v1/contacts/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ lifecycle: "WHALE" });
    expect(invalid.status).toBe(400);

    const res = await api
      .put(`/api/v1/contacts/${created.body.data.id}`)
      .set(auth(adminToken))
      .send({ lifecycle: "PROSPECT", company: `${MARK} Corp`, tags: ["vip"] });
    expect(res.status).toBe(200);
    expect(res.body.data.lifecycle).toBe("PROSPECT");
    expect(res.body.data.company).toBe(`${MARK} Corp`);
    expect(res.body.data.tags).toEqual(["vip"]);
  });

  it("deletes a contact", async () => {
    const created = await api
      .post("/api/v1/contacts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Deletable` });
    const id = created.body.data.id;

    const res = await api.delete(`/api/v1/contacts/${id}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.ok).toBe(true);

    const gone = await api.get(`/api/v1/contacts/${id}`).set(auth(adminToken));
    expect(gone.status).toBe(404);
  });

  it("blocks cross-tenant access with 404", async () => {
    const created = await api
      .post("/api/v1/contacts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Isolated` });
    createdContactIds.push(created.body.data.id);

    const fetch = await api
      .get(`/api/v1/contacts/${created.body.data.id}`)
      .set(auth(esAdminToken));
    expect(fetch.status).toBe(404);

    const update = await api
      .put(`/api/v1/contacts/${created.body.data.id}`)
      .set(auth(esAdminToken))
      .send({ name: "Hijacked" });
    expect(update.status).toBe(404);
  });

  it("denies the FINANCE role access to contacts", async () => {
    const res = await api.get("/api/v1/contacts").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});
