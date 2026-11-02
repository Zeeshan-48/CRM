import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, NW_ADMIN, login } from "../helpers";

// Campaign execution: bulk-send an EMAIL/WHATSAPP campaign to a tag audience.
// Sends are simulated under the test runner (no SES/Meta), so nothing leaves.
const RUN = ulid().toLowerCase();
const TAG = `campaign-tag-${RUN}`;

let adminToken: string;
let tenantId: string;
const leadIds: string[] = [];
const campaignIds: string[] = [];

const insertLead = async (name: string, email: string | null, tags: string[]): Promise<string> => {
  const now = new Date();
  const id = ulid();
  await db
    .insertInto("leads")
    .values({
      id,
      tenant_id: tenantId,
      name,
      email,
      phone: "+919000000000",
      status: "NEW",
      tags: JSON.stringify(tags),
      created_at: now,
      updated_at: now,
    })
    .execute();
  leadIds.push(id);
  return id;
};

const createCampaign = async (body: Record<string, unknown>): Promise<string> => {
  const res = await api.post("/api/v1/campaigns").set(auth(adminToken)).send(body);
  expect(res.status).toBe(201);
  campaignIds.push(res.body.data.id);
  return res.body.data.id;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;

  await insertLead(`CampaignOne ${RUN}`, `c1.${RUN}@example.com`, [TAG]);
  await insertLead(`CampaignTwo ${RUN}`, `c2.${RUN}@example.com`, [TAG]);
  await insertLead(`CampaignNoEmail ${RUN}`, null, [TAG]); // in audience, but no email
  await insertLead(`CampaignUntagged ${RUN}`, `c4.${RUN}@example.com`, []); // not in audience
});

afterAll(async () => {
  if (leadIds.length) {
    await db.deleteFrom("messages").where("lead_id", "in", leadIds).execute();
    await db.deleteFrom("conversations").where("lead_id", "in", leadIds).execute();
    await db.deleteFrom("leads").where("id", "in", leadIds).execute();
  }
  if (campaignIds.length) {
    await db.deleteFrom("campaigns").where("id", "in", campaignIds).execute();
  }
  await closeDB();
});

describe("campaign send", () => {
  it("sends an EMAIL campaign to the tagged audience and records the result", async () => {
    const id = await createCampaign({
      name: `Email blast ${RUN}`,
      channel: "Email",
      audienceTag: TAG,
      subject: "Hi {name}",
      body: "Hello {name}, offer inside.",
    });

    const res = await api.post(`/api/v1/campaigns/${id}/send`).set(auth(adminToken));
    expect(res.status).toBe(200);
    // 3 leads carry the tag; 2 have an email (attempted), 1 is skipped.
    expect(res.body.data.recipients).toBe(3);
    // Under the test runner email is simulated, so nothing is really delivered:
    // sent (real) = 0, simulated = 2, skipped = 1.
    expect(res.body.data.sent).toBe(0);
    expect(res.body.data.simulated).toBe(2);
    expect(res.body.data.skipped).toBe(1);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(res.body.data.sent_at).toBeTruthy();

    // Outbound EMAIL messages recorded for the two emailable leads.
    const msgs = await db
      .selectFrom("messages")
      .select(["id"])
      .where("lead_id", "in", leadIds)
      .where("channel", "=", "EMAIL")
      .where("direction", "=", "OUTBOUND")
      .where("body", "like", `%offer inside%`)
      .execute();
    expect(msgs.length).toBe(2);
  });

  it("refuses to send the same campaign twice", async () => {
    const id = await createCampaign({
      name: `Once only ${RUN}`,
      channel: "Email",
      audienceTag: TAG,
      body: "Hi {name}",
    });
    const first = await api.post(`/api/v1/campaigns/${id}/send`).set(auth(adminToken));
    expect(first.status).toBe(200);
    const second = await api.post(`/api/v1/campaigns/${id}/send`).set(auth(adminToken));
    expect(second.status).toBe(400);
  });

  it("refuses to send a non-Email/WhatsApp channel", async () => {
    const id = await createCampaign({ name: `Ad ${RUN}`, channel: "Google", body: "x" });
    const res = await api.post(`/api/v1/campaigns/${id}/send`).set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("refuses to send a campaign with no message content", async () => {
    const id = await createCampaign({ name: `Empty ${RUN}`, channel: "Email", audienceTag: TAG });
    const res = await api.post(`/api/v1/campaigns/${id}/send`).set(auth(adminToken));
    expect(res.status).toBe(400);
  });
});
