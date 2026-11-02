import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SALES, login } from "../helpers";

let adminToken: string;
let salesToken: string;
let esAdminToken: string;
let nwTenantId: string;
let adminUserId: string;
let adminUserName: string;
const markerAction = `qa.audit_${Date.now()}`;
const createdAuditIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);

  const me = await api.get("/api/v1/auth/me").set(auth(adminToken));
  adminUserId = me.body.data.user.id as string;
  adminUserName = me.body.data.user.name as string;
  const tenant = await api.get("/api/v1/tenant/me").set(auth(adminToken));
  nwTenantId = tenant.body.data.tenant.id as string;

  for (const entityType of ["lead", "deal"]) {
    const id = ulid();
    createdAuditIds.push(id);
    await db
      .insertInto("audit_logs")
      .values({
        id,
        tenant_id: nwTenantId,
        user_id: adminUserId,
        action: markerAction,
        entity_type: entityType,
        entity_id: ulid(),
        meta: JSON.stringify({ marker: true }),
        created_at: new Date(),
      })
      .execute();
  }
});

afterAll(async () => {
  for (const id of createdAuditIds) {
    await db.deleteFrom("audit_logs").where("id", "=", id).execute();
  }
  await closeDB();
});

describe("audit trail", () => {
  it("lists the latest entries first, capped at 200, with actor names resolved", async () => {
    const res = await api.get("/api/v1/audit").set(auth(adminToken));
    expect(res.status).toBe(200);
    const rows = res.body.data;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(200);
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Latest first.
    const t0 = new Date(rows[0].created_at).getTime();
    const tLast = new Date(rows[rows.length - 1].created_at).getTime();
    expect(t0).toBeGreaterThanOrEqual(tLast);

    const marker = rows.find((r: { action: string }) => r.action === markerAction);
    expect(marker).toBeTruthy();
    expect(marker.user).toBe(adminUserName);
  });

  it("filters by action and entityType", async () => {
    const byAction = await api
      .get(`/api/v1/audit?action=${markerAction}`)
      .set(auth(adminToken));
    expect(byAction.status).toBe(200);
    expect(byAction.body.data.length).toBe(2);
    expect(
      byAction.body.data.every((r: { action: string }) => r.action === markerAction)
    ).toBe(true);

    const byBoth = await api
      .get(`/api/v1/audit?action=${markerAction}&entityType=lead`)
      .set(auth(adminToken));
    expect(byBoth.status).toBe(200);
    expect(byBoth.body.data.length).toBe(1);
    expect(byBoth.body.data[0].entity_type).toBe("lead");
  });

  it("is tenant-scoped: another tenant cannot see the entries", async () => {
    const res = await api.get(`/api/v1/audit?action=${markerAction}`).set(auth(esAdminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it("blocks roles without the audit module", async () => {
    const res = await api.get("/api/v1/audit").set(auth(salesToken));
    expect(res.status).toBe(403);
  });
});

describe("compliance posture", () => {
  it("returns the GDPR/SOC2/ISO checklist with the tenant audit event count", async () => {
    const res = await api.get("/api/v1/audit/compliance").set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.gdpr).toEqual({ enabled: true, dataRetentionDays: 365, rightToErasure: true });
    expect(data.soc2).toEqual({ status: "In progress" });
    expect(data.iso27001).toEqual({ status: "Planned" });
    expect(data.security.sso).toEqual(["Google", "Microsoft", "SAML"]);
    expect(data.security.mfa).toBe(true);
    expect(data.security.deviceControl).toBe(true);
    expect(data.auditEvents).toBeGreaterThanOrEqual(2);
  });
});
