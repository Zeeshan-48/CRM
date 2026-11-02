import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import emailDomainsRepository from "../../src/repositories/email-domains.repository";
import emailIdentitiesRepository from "../../src/repositories/email-identities.repository";
import emailSuppressionsRepository from "../../src/repositories/email-suppressions.repository";
import mailerService from "../../src/services/mailer.service";
import { api, auth, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let tenantId: string;
let domainId: string;

const sub = `send-test-${Date.now()}.northwind.example.com`;
const fromAddress = `crm@${sub}`;
const customRecipient = `custom-${Date.now()}@example.com`;
const blockedRecipient = `blocked-${Date.now()}@example.com`;
const legacyRecipient = `legacy-${Date.now()}@example.com`;

const cleanup = async () => {
  // Scoped to this run's recipients: legacy sends are tracked in email_messages
  // too, so a tenant-wide delete would wipe the tenant's real send history.
  await db
    .deleteFrom("email_messages")
    .where("tenant_id", "=", tenantId)
    .where("to_address", "in", [customRecipient, blockedRecipient, legacyRecipient])
    .execute();
  await db.deleteFrom("email_suppressions").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("email_sender_identities").where("tenant_id", "=", tenantId).execute();
  await db.deleteFrom("email_sending_domains").where("tenant_id", "=", tenantId).execute();
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  tenantId = tenant.id;
  await cleanup();

  // A verified custom domain with a default NOTIFICATION sender.
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
  await emailDomainsRepository.update(domainId, tenantId, {
    status: "VERIFIED",
    verified_at: new Date(),
  });
  await emailIdentitiesRepository.create({
    tenant_id: tenantId,
    sending_domain_id: domainId,
    email_address: fromAddress,
    display_name: "Acme Team",
    reply_to: null,
    is_default_transactional: false,
    is_default_notification: true,
    is_default_marketing: false,
  });
});

afterAll(async () => {
  await cleanup();
  await closeDB();
});

describe("send resolver: custom domain", () => {
  it("sends from the verified domain and tracks an email_messages row", async () => {
    const result = await mailerService.send({
      tenantId,
      category: "NOTIFICATION",
      to: customRecipient,
      subject: "Welcome",
      text: "Hello from the custom domain",
    });
    expect(result.mode).toBe("custom");

    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("to_address", "=", customRecipient)
      .executeTakeFirst();
    expect(row).toBeTruthy();
    expect(row?.status).toBe("SENT");
    expect(row?.from_address).toBe(fromAddress);
    expect(row?.sending_domain_id).toBe(domainId);
    expect(row?.ses_message_id).toBeTruthy();
  });

  it("does not send to a suppressed recipient", async () => {
    await emailSuppressionsRepository.add(tenantId, blockedRecipient, "ADMIN_BLOCK", null);
    const result = await mailerService.send({
      tenantId,
      category: "NOTIFICATION",
      to: blockedRecipient,
      subject: "Should not arrive",
      text: "nope",
    });
    expect(result.suppressed).toBe(true);

    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("to_address", "=", blockedRecipient)
      .executeTakeFirst();
    expect(row?.status).toBe("SUPPRESSED");
  });

  it("falls back to legacy when no default identity exists for the category", async () => {
    // No MARKETING default identity, so the resolver picks legacy.
    const result = await mailerService.send({
      tenantId,
      category: "MARKETING",
      to: legacyRecipient,
      subject: "Legacy",
      text: "via platform default",
    });
    expect(result.mode).toBe("legacy");

    // Legacy sends are tracked too: without an email_messages row (and the
    // messageId tag derived from it) SES events could never be correlated back,
    // so delivery/open/click would silently stay at zero.
    const row = await db
      .selectFrom("email_messages")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("to_address", "=", legacyRecipient)
      .executeTakeFirst();
    expect(row).toBeTruthy();
    expect(row?.status).toBe("SENT");
    expect(row?.ses_message_id).toBeTruthy();
    // Platform sender, so no tenant domain/identity is attached.
    expect(row?.sending_domain_id).toBeNull();
    expect(row?.sender_identity_id).toBeNull();
  });
});

describe("email message log and suppressions API", () => {
  it("lists email messages", async () => {
    const res = await api.get("/api/v1/email-messages").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.some((m: { to_address: string }) => m.to_address === customRecipient)).toBe(
      true
    );
  });

  it("adds, lists and removes a manual suppression", async () => {
    const manual = `manual-${Date.now()}@example.com`;
    const add = await api
      .post("/api/v1/email-suppressions")
      .set(auth(adminToken))
      .send({ email: manual });
    expect(add.status).toBe(201);

    const list = await api.get("/api/v1/email-suppressions").set(auth(adminToken));
    expect(list.status).toBe(200);
    const found = list.body.data.find((s: { email: string }) => s.email === manual);
    expect(found).toBeTruthy();

    const del = await api
      .delete(`/api/v1/email-suppressions/${found.id}`)
      .set(auth(adminToken));
    expect(del.status).toBe(200);
  });

  it("denies suppression writes to non-privileged roles", async () => {
    const res = await api
      .post("/api/v1/email-suppressions")
      .set(auth(salesToken))
      .send({ email: "x@example.com" });
    expect(res.status).toBe(403);
  });
});
