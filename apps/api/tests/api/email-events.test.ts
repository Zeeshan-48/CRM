import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import emailDomainsRepository from "../../src/repositories/email-domains.repository";
import emailMessagesRepository from "../../src/repositories/email-messages.repository";
import emailEventsService from "../../src/services/email-events.service";

let tenantId: string;
let domainId: string;
let deliveredMsgId: string;
let bouncedMsgId: string;

const sub = `events-test-${Date.now()}.northwind.example.com`;
const bouncedRecipient = `bounce-${Date.now()}@example.com`;

const sesEvent = (eventType: string, messageId: string, extra: object = {}) =>
  JSON.stringify({
    eventType,
    mail: { tags: { tenantId: [tenantId], messageId: [messageId], category: ["NOTIFICATION"] } },
    ...extra,
  });

beforeAll(async () => {
  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;

  const domain = await emailDomainsRepository.create({
    tenant_id: tenantId,
    subdomain: sub,
    mail_from_subdomain: `bounce.${sub}`,
    ses_configuration_set: `email-tenant-${tenantId}`,
    dkim_status: "SUCCESS",
    mail_from_status: "SUCCESS",
    dns_records: [],
  });
  domainId = domain.id;

  const make = async (to: string) =>
    (
      await emailMessagesRepository.create({
        tenant_id: tenantId,
        category: "NOTIFICATION",
        sending_domain_id: domainId,
        sender_identity_id: null,
        from_address: `crm@${sub}`,
        to_address: to,
        subject: "evt",
        idempotency_key: null,
        status: "SENT",
      })
    ).id;
  deliveredMsgId = await make(`ok-${Date.now()}@example.com`);
  bouncedMsgId = await make(bouncedRecipient);
});

afterAll(async () => {
  await db.deleteFrom("email_messages").where("tenant_id", "=", tenantId).where("sending_domain_id", "=", domainId).execute();
  await db.deleteFrom("email_suppressions").where("tenant_id", "=", tenantId).where("email", "=", bouncedRecipient).execute();
  await db.deleteFrom("email_sending_domains").where("id", "=", domainId).execute();
  await closeDB();
});

describe("SES events processing", () => {
  it("marks a message DELIVERED", async () => {
    await emailEventsService.processRaw(sesEvent("Delivery", deliveredMsgId));
    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("id", "=", deliveredMsgId)
      .executeTakeFirst();
    expect(row?.status).toBe("DELIVERED");
    expect(row?.delivered_at).toBeTruthy();
  });

  it("is idempotent for redelivered events", async () => {
    await emailEventsService.processRaw(sesEvent("Delivery", deliveredMsgId));
    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("id", "=", deliveredMsgId)
      .executeTakeFirst();
    expect(row?.status).toBe("DELIVERED");
  });

  it("bounces (permanent) and suppresses the recipient", async () => {
    await emailEventsService.processRaw(
      sesEvent("Bounce", bouncedMsgId, {
        bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: bouncedRecipient }] },
      })
    );
    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("id", "=", bouncedMsgId)
      .executeTakeFirst();
    expect(row?.status).toBe("BOUNCED");

    const sup = await db
      .selectFrom("email_suppressions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("email", "=", bouncedRecipient)
      .executeTakeFirst();
    expect(sup?.reason).toBe("HARD_BOUNCE");
  });

  it("ignores events without a messageId tag", async () => {
    // Should not throw.
    await emailEventsService.processRaw(JSON.stringify({ eventType: "Delivery", mail: { tags: {} } }));
  });

  it("records an open timestamp without changing delivered status", async () => {
    await emailEventsService.processRaw(sesEvent("Open", deliveredMsgId));
    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("id", "=", deliveredMsgId)
      .executeTakeFirst();
    expect(row?.opened_at).toBeTruthy();
    expect(row?.status).toBe("DELIVERED");
  });
});
