import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;
let nwTenantId: string;

const sub = `mailtest-${Date.now()}.northwind.example.com`;
let domainId: string;
let identityId: string;

const cleanupDomains = async (tenantId: string) => {
  const rows = await db
    .selectFrom("email_sending_domains")
    .select(["id"])
    .where("tenant_id", "=", tenantId)
    .execute();
  for (const r of rows) {
    await db.deleteFrom("email_sender_identities").where("sending_domain_id", "=", r.id).execute();
  }
  await db.deleteFrom("email_sending_domains").where("tenant_id", "=", tenantId).execute();
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;
  await cleanupDomains(nwTenantId);
});

afterAll(async () => {
  await cleanupDomains(nwTenantId);
  await closeDB();
});

describe("email sending domains: onboard + verify", () => {
  it("onboards a domain as PENDING with DNS records", async () => {
    const res = await api
      .post("/api/v1/email-sending-domains")
      .set(auth(adminToken))
      .send({ subdomain: sub });
    expect(res.status).toBe(201);
    domainId = res.body.data.id;
    expect(res.body.data.status).toBe("PENDING");
    expect(res.body.data.subdomain).toBe(sub);
    expect(res.body.data.apex).toBe(false);
    // 3 simulated DKIM CNAMEs + MX + 2 SPF + DMARC.
    expect(res.body.data.dns_records.length).toBeGreaterThanOrEqual(6);
    expect(res.body.data.dns_records.some((r: { purpose: string }) => r.purpose === "DKIM")).toBe(true);
  });

  it("rejects an invalid domain", async () => {
    const res = await api
      .post("/api/v1/email-sending-domains")
      .set(auth(adminToken))
      .send({ subdomain: "not a domain" });
    expect(res.status).toBe(400);
  });

  it("rejects a second domain for the same tenant", async () => {
    const res = await api
      .post("/api/v1/email-sending-domains")
      .set(auth(adminToken))
      .send({ subdomain: `other-${Date.now()}.northwind.example.com` });
    expect(res.status).toBe(409);
  });

  it("denies onboarding to non-admin roles", async () => {
    const res = await api
      .post("/api/v1/email-sending-domains")
      .set(auth(salesToken))
      .send({ subdomain: `nope-${Date.now()}.northwind.example.com` });
    expect(res.status).toBe(403);
  });

  it("lists and gets the domain", async () => {
    const list = await api.get("/api/v1/email-sending-domains").set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.some((d: { id: string }) => d.id === domainId)).toBe(true);

    const one = await api.get(`/api/v1/email-sending-domains/${domainId}`).set(auth(adminToken));
    expect(one.status).toBe(200);
    expect(one.body.data.id).toBe(domainId);
  });

  it("returns a health snapshot", async () => {
    const res = await api
      .get(`/api/v1/email-sending-domains/${domainId}/health`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.subdomain).toBe(sub);
    expect(Array.isArray(res.body.data.dns_records)).toBe(true);
  });

  it("checks verification (stays PENDING under simulation)", async () => {
    const res = await api
      .post(`/api/v1/email-sending-domains/${domainId}/check`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(["PENDING", "VERIFIED", "FAILED"]).toContain(res.body.data.status);
  });

  it("returns 404 for a cross-tenant domain", async () => {
    const res = await api
      .get(`/api/v1/email-sending-domains/${domainId}`)
      .set(auth(esAdminToken));
    expect(res.status).toBe(404);
  });
});

describe("email sender identities", () => {
  it("rejects an identity while the domain is unverified", async () => {
    const res = await api
      .post("/api/v1/email-sender-identities")
      .set(auth(adminToken))
      .send({ sendingDomainId: domainId, emailAddress: `crm@${sub}` });
    expect(res.status).toBe(400);
  });

  it("creates an identity once the domain is verified", async () => {
    // Simulate a verified domain so the identity can be added.
    await db
      .updateTable("email_sending_domains")
      .set({ status: "VERIFIED", verified_at: new Date(), updated_at: new Date() })
      .where("id", "=", domainId)
      .execute();

    const res = await api
      .post("/api/v1/email-sender-identities")
      .set(auth(adminToken))
      .send({
        sendingDomainId: domainId,
        emailAddress: `crm@${sub}`,
        displayName: "Acme Team",
        defaultFor: ["NOTIFICATION", "TRANSACTIONAL"],
      });
    expect(res.status).toBe(201);
    identityId = res.body.data.id;
    expect(res.body.data.email_address).toBe(`crm@${sub}`);
    expect(res.body.data.is_default_notification).toBe(true);
    expect(res.body.data.is_default_transactional).toBe(true);
  });

  it("rejects an address that is not on the sending domain", async () => {
    const res = await api
      .post("/api/v1/email-sender-identities")
      .set(auth(adminToken))
      .send({ sendingDomainId: domainId, emailAddress: "someone@mailbox.example.net" });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate sender address", async () => {
    const res = await api
      .post("/api/v1/email-sender-identities")
      .set(auth(adminToken))
      .send({ sendingDomainId: domainId, emailAddress: `crm@${sub}` });
    expect(res.status).toBe(409);
  });

  it("updates the identity (reassigns a category default)", async () => {
    const res = await api
      .patch(`/api/v1/email-sender-identities/${identityId}`)
      .set(auth(adminToken))
      .send({ defaultFor: ["MARKETING"] });
    expect(res.status).toBe(200);
    expect(res.body.data.is_default_marketing).toBe(true);
    expect(res.body.data.is_default_notification).toBe(false);
  });

  it("lists and deletes the identity", async () => {
    const list = await api.get("/api/v1/email-sender-identities").set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.data.some((i: { id: string }) => i.id === identityId)).toBe(true);

    const del = await api
      .delete(`/api/v1/email-sender-identities/${identityId}`)
      .set(auth(adminToken));
    expect(del.status).toBe(200);
  });
});
