import crypto from "crypto";
import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../../src/config";
import { closeDB, db } from "../../src/db/connection";
import engineService from "../../src/services/engine.service";
import inboundService from "../../src/services/inbound.service";
import { api } from "../helpers";

// Inbound ingestion (channel-agnostic) + the WhatsApp webhook. Sender matching,
// lead auto-creation, dedup, delivery-status updates, and the verify/receive
// webhook. Snapshots/restores the tenant's WhatsApp config for the webhook part.
const RUN = ulid().toLowerCase();
const LEAD_PHONE = "+919812300000";
const LEAD_EMAIL = `inbound.${RUN}@example.com`;
const VERIFY_TOKEN = `verify-${RUN}`;
const WABA_ID = `waba-${RUN}`;

let tenantId: string;
let leadId: string;
let savedWa: Record<string, unknown> | null = null;
const extraLeadIds: string[] = [];

beforeAll(async () => {
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;

  const now = new Date();
  leadId = ulid();
  await db
    .insertInto("leads")
    .values({
      id: leadId,
      tenant_id: tenantId,
      name: `Inbound Lead ${RUN}`,
      email: LEAD_EMAIL,
      phone: LEAD_PHONE,
      status: "NEW",
      tags: JSON.stringify([]),
      created_at: now,
      updated_at: now,
    })
    .execute();

  savedWa =
    ((await db
      .selectFrom("tenant_whatsapp")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst()) as Record<string, unknown> | undefined) ?? null;
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  await db
    .insertInto("tenant_whatsapp")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      provider: "META",
      phone_number_id: "123456789012345",
      waba_id: WABA_ID,
      webhook_verify_token: VERIFY_TOKEN,
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  const allLeads = [leadId, ...extraLeadIds];
  await db.deleteFrom("messages").where("lead_id", "in", allLeads).execute();
  await db.deleteFrom("conversations").where("lead_id", "in", allLeads).execute();
  await db.deleteFrom("leads").where("id", "in", allLeads).execute();
  await db.deleteFrom("tenant_whatsapp").where("tenant_id", "=", tenantId).execute();
  if (savedWa) {
    await db.insertInto("tenant_whatsapp").values(savedWa as never).execute();
  }
  await closeDB();
});

describe("inbound ingestion", () => {
  it("matches an inbound WhatsApp to the existing lead by phone", async () => {
    const extId = `wamid.${RUN}.1`;
    const res = await inboundService.ingest({
      tenantId,
      channel: "WHATSAPP",
      from: LEAD_PHONE,
      body: "hi there",
      externalId: extId,
    });
    expect(res.deduped).toBe(false);
    expect(res.leadId).toBe(leadId);

    const msg = await db
      .selectFrom("messages")
      .selectAll()
      .where("external_id", "=", extId)
      .executeTakeFirst();
    expect(msg?.direction).toBe("INBOUND");
    expect(msg?.lead_id).toBe(leadId);
    expect(msg?.channel).toBe("WHATSAPP");
  });

  it("dedups a redelivered message by external id", async () => {
    const extId = `wamid.${RUN}.1`; // same id as above
    const res = await inboundService.ingest({
      tenantId,
      channel: "WHATSAPP",
      from: LEAD_PHONE,
      body: "hi there again",
      externalId: extId,
    });
    expect(res.deduped).toBe(true);
  });

  it("auto-creates a lead for an unknown inbound sender", async () => {
    const unknown = "+919899990000";
    const res = await inboundService.ingest({
      tenantId,
      channel: "WHATSAPP",
      from: unknown,
      name: "Unknown Person",
      body: "new here",
      externalId: `wamid.${RUN}.new`,
    });
    expect(res.createdLead).toBe(true);
    expect(res.leadId).toBeTruthy();
    if (res.leadId) extraLeadIds.push(res.leadId);

    const lead = await db
      .selectFrom("leads")
      .select(["phone", "source"])
      .where("id", "=", res.leadId as string)
      .executeTakeFirstOrThrow();
    expect(lead.phone).toBe(unknown);
    expect(lead.source).toBe("Whatsapp");
  });

  it("matches an inbound EMAIL to the existing lead by address", async () => {
    const res = await inboundService.ingest({
      tenantId,
      channel: "EMAIL",
      from: LEAD_EMAIL.toUpperCase(), // case-insensitive
      body: "email reply",
      subject: "Re: offer",
      externalId: `email.${RUN}.1`,
    });
    expect(res.leadId).toBe(leadId);
  });

  it("applies a delivery status to the matching outbound message", async () => {
    const extId = `wamid.${RUN}.out`;
    await engineService.sendMessage({
      tenantId,
      channel: "WHATSAPP",
      ref: { leadId, subject: "WhatsApp" },
      direction: "OUTBOUND",
      body: "outbound",
      externalId: extId,
      status: "sent",
    });
    await inboundService.applyStatus(tenantId, extId, "read");

    const msg = await db
      .selectFrom("messages")
      .select(["status"])
      .where("external_id", "=", extId)
      .executeTakeFirstOrThrow();
    expect(msg.status).toBe("read");
  });
});

describe("whatsapp webhook", () => {
  it("verifies the GET handshake with a matching token", async () => {
    const res = await api
      .get(`/api/v1/wa/webhooks/${VERIFY_TOKEN}`)
      .query({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": "CHAL123" });
    expect(res.status).toBe(200);
    expect(res.text).toBe("CHAL123");
  });

  it("rejects the GET handshake with a wrong token", async () => {
    const res = await api
      .get(`/api/v1/wa/webhooks/${VERIFY_TOKEN}`)
      .query({ "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "X" });
    expect(res.status).toBe(403);
  });

  it("accepts a POST and ingests the inbound message", async () => {
    const extId = `wamid.${RUN}.hook`;
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "Hook Sender" }, wa_id: LEAD_PHONE.replace("+", "") }],
                messages: [
                  { from: LEAD_PHONE.replace("+", ""), id: extId, type: "text", text: { body: "from webhook" } },
                ],
              },
            },
          ],
        },
      ],
    };
    const res = await api.post(`/api/v1/wa/webhooks/${VERIFY_TOKEN}`).send(payload);
    expect(res.status).toBe(200);

    // Processing is async after the ack; poll briefly for the ingested message.
    let msg: { direction: string } | undefined;
    for (let i = 0; i < 20 && !msg; i++) {
      msg = await db
        .selectFrom("messages")
        .select(["direction"])
        .where("external_id", "=", extId)
        .executeTakeFirst();
      if (!msg) await new Promise((r) => setTimeout(r, 100));
    }
    expect(msg?.direction).toBe("INBOUND");
  });
});
