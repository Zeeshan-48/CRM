import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  login,
  NW_ADMIN,
  NW_SALES,
} from "../helpers";
import { login as operatorLogin, ROOT_OPERATOR } from "../operator/helpers";

const marker = Date.now().toString(36);
let rootToken: string;
let nwAdminToken: string;
let nwSalesToken: string;
let freshTenantId: string;
let freshAdminToken: string;
const cleanupLeadIds: string[] = [];
const cleanupWorkflowIds: string[] = [];
const cleanupContactIds: string[] = [];
const cleanupAccountIds: string[] = [];
const cleanupDealIds: string[] = [];

beforeAll(async () => {
  rootToken = await operatorLogin(ROOT_OPERATOR.email, ROOT_OPERATOR.password);
  nwAdminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  nwSalesToken = await login(NW_SALES.email, NW_SALES.password);

  // Onboard a fresh tenant with zero import formats enabled initially ("Blocked until enabled")
  const onboard = await api
    .post("/api/v1/operator/tenants")
    .set(auth(rootToken))
    .send({
      name: `Import Gate ${marker}`,
      slug: `import-gate-${marker}`,
      plan_key: "ENTERPRISE",
      allowed_import_types: [],
      admin: {
        name: "Gate Admin",
        email: `gate-admin-${marker}@example.com`,
      },
    });
  expect(onboard.status).toBe(201);
  freshTenantId = onboard.body.data.tenant.id;

  const setPassRes = await db
    .selectFrom("users")
    .select("id")
    .where("tenant_id", "=", freshTenantId)
    .executeTakeFirstOrThrow();
  const bcrypt = await import("bcrypt");
  const hash = await bcrypt.hash("pass1234", 10);
  await db
    .updateTable("users")
    .set({ password_hash: hash })
    .where("id", "=", setPassRes.id)
    .execute();

  freshAdminToken = await login(`gate-admin-${marker}@example.com`, "pass1234");
});

afterAll(async () => {
  for (const id of cleanupDealIds) {
    await db.deleteFrom("deals").where("id", "=", id).execute();
  }
  for (const id of cleanupContactIds) {
    await db.deleteFrom("contacts").where("id", "=", id).execute();
  }
  for (const id of cleanupAccountIds) {
    await db.deleteFrom("accounts").where("id", "=", id).execute();
  }
  for (const id of cleanupLeadIds) {
    await db.deleteFrom("leads").where("id", "=", id).execute();
  }
  for (const id of cleanupWorkflowIds) {
    await db.deleteFrom("workflows").where("id", "=", id).execute();
  }
  if (freshTenantId) {
    await db.deleteFrom("tenants").where("id", "=", freshTenantId).execute();
  }
  await closeDB();
});

describe("Super Admin import format control & 4-type import", () => {
  it("blocks bulk import until Super Admin enables at least one format", async () => {
    const me = await api.get("/api/v1/auth/me").set(auth(freshAdminToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.tenant.allowed_import_types).toEqual([]);

    const res = await api
      .post("/api/v1/leads/bulk")
      .set(auth(freshAdminToken))
      .send({
        importType: "sales",
        rows: [{ company_name: "Test Co", email: `blocked-${marker}@example.com` }],
      });
    expect(res.status).toBe(403);
  });

  it("allows only Super Admin enabled formats and rejects disallowed ones", async () => {
    const upd = await api
      .put(`/api/v1/operator/tenants/${freshTenantId}`)
      .set(auth(rootToken))
      .send({ allowed_import_types: ["sales", "student_admission", "medical"] });
    expect(upd.status).toBe(200);
    expect(upd.body.data.allowed_import_types).toEqual(["sales", "student_admission", "medical"]);

    // Disallowed type ("construction") still blocked with 403
    const denied = await api
      .post("/api/v1/leads/bulk")
      .set(auth(freshAdminToken))
      .send({
        importType: "construction",
        rows: [{ business_name: "Denied Builders", email: `c-${marker}@example.com` }],
      });
    expect(denied.status).toBe(403);

    // Allowed sales import stores structured extra_fields + filters cleanly
    const salesRes = await api
      .post("/api/v1/leads/bulk")
      .set(auth(freshAdminToken))
      .send({
        importType: "sales",
        rows: [
          {
            company_name: "MCA Sales Tech",
            cin: `U72900MH2022PTC${marker.slice(-6).toUpperCase()}`,
            email: `sales-${marker}@example.com`,
            director_name: "Rohan Das",
            mobile: "9800001101",
            state: "Maharashtra",
            activity: "Software Consultancy",
          },
        ],
      });
    expect(salesRes.status).toBe(201);
    expect(salesRes.body.data.imported).toBe(1);

    // Allowed student admission import
    const stuRes = await api
      .post("/api/v1/leads/bulk")
      .set(auth(freshAdminToken))
      .send({
        importType: "student_admission",
        rows: [
          {
            name: "Anjali Student",
            mobile: "9800001102",
            email: `stu-${marker}@example.com`,
            state_city: "Delhi",
            exam: "NEET",
            percentage: "94.2%",
          },
        ],
      });
    expect(stuRes.status).toBe(201);
    expect(stuRes.body.data.imported).toBe(1);

    // Allowed medical import + auto Account conversion
    const medRes = await api
      .post("/api/v1/leads/bulk")
      .set(auth(freshAdminToken))
      .send({
        importType: "medical",
        rows: [
          {
            business_name: `Apex Medico ${marker}`,
            owner_name: "Dr. Meena",
            email: `med-${marker}@example.com`,
            address: "45 Park Lane, Pune",
            mobile: "9800001103",
          },
        ],
      });
    expect(medRes.status).toBe(201);

    // Filter by importType & search inside extra_fields
    const stuList = await api
      .get("/api/v1/leads?importType=student_admission")
      .set(auth(freshAdminToken));
    expect(stuList.status).toBe(200);
    expect(stuList.body.data.leads.length).toBe(1);
    expect(stuList.body.data.leads[0].extra_fields).toEqual({
      state_city: "Delhi",
      exam: "NEET",
      percentage: "94.2%",
    });

    const searchByCin = await api
      .get("/api/v1/leads?q=Software Consultancy")
      .set(auth(freshAdminToken));
    expect(searchByCin.body.data.leads.length).toBe(1);
    expect(searchByCin.body.data.leads[0].import_type).toBe("sales");

    const medList = await api
      .get("/api/v1/leads?importType=medical")
      .set(auth(freshAdminToken));
    const medLeadId = medList.body.data.leads[0].id;
    const conv = await api
      .post(`/api/v1/leads/${medLeadId}/convert`)
      .set(auth(freshAdminToken))
      .send({ createDeal: false });
    expect(conv.status).toBe(201);
    expect(conv.body.data.contact.account_id).toBeTruthy();
  });
});

describe("Upload-time lead assignment on bulk import", () => {
  it("assigns all imported rows to a single selected user and prevents workflow ASSIGN_AGENT override", async () => {
    const usersRes = await api.get("/api/v1/users").set(auth(nwAdminToken));
    const salesAgents = (usersRes.body.data as { id: string; email: string; role: string }[]).filter(
      (u) => u.role === "SALES_AGENT"
    );
    expect(salesAgents.length).toBeGreaterThanOrEqual(2);
    const targetA = salesAgents[0];
    const targetB = salesAgents[1];

    // Create active ASSIGN_AGENT workflow to prove explicit upload-time owner is preserved
    const wf = await api
      .post("/api/v1/workflows")
      .set(auth(nwAdminToken))
      .send({
        name: `Import Preserve Test ${marker}`,
        trigger: "lead.created",
        actions: [{ type: "ASSIGN_AGENT", params: { role: "SALES_AGENT" } }],
        active: true,
      });
    expect(wf.status).toBe(201);
    cleanupWorkflowIds.push(wf.body.data.id);

    const singleImport = await api
      .post("/api/v1/leads/bulk")
      .set(auth(nwAdminToken))
      .send({
        importType: "sales",
        assignment: { mode: "single", ownerIds: [targetA.id] },
        rows: [
          { director_name: `SingleAssign1 ${marker}`, email: `sa1-${marker}@example.com` },
          { director_name: `SingleAssign2 ${marker}`, email: `sa2-${marker}@example.com` },
          { director_name: `SingleAssign3 ${marker}`, email: `sa3-${marker}@example.com` },
        ],
      });
    expect(singleImport.status).toBe(201);
    expect(singleImport.body.data.imported).toBe(3);

    const listSingle = await api
      .get(`/api/v1/leads?q=SingleAssign`)
      .set(auth(nwAdminToken));
    const matchingSingle = (listSingle.body.data.leads as { id: string; name: string; owner_id: string | null }[]).filter(
      (l) => l.name.includes(marker)
    );
    expect(matchingSingle.length).toBe(3);
    for (const l of matchingSingle) {
      cleanupLeadIds.push(l.id);
      expect(l.owner_id).toBe(targetA.id);
    }

    // Round-robin split between targetA and targetB
    const splitImport = await api
      .post("/api/v1/leads/bulk")
      .set(auth(nwAdminToken))
      .send({
        importType: "student_admission",
        assignment: { mode: "round_robin", ownerIds: [targetA.id, targetB.id] },
        rows: [
          { name: `Split1 ${marker}`, email: `sp1-${marker}@example.com` },
          { name: `Split2 ${marker}`, email: `sp2-${marker}@example.com` },
          { name: `Split3 ${marker}`, email: `sp3-${marker}@example.com` },
          { name: `Split4 ${marker}`, email: `sp4-${marker}@example.com` },
        ],
      });
    expect(splitImport.status).toBe(201);
    expect(splitImport.body.data.imported).toBe(4);

    const listSplit = await api
      .get(`/api/v1/leads?q=Split`)
      .set(auth(nwAdminToken));
    const matchingSplit = (listSplit.body.data.leads as { id: string; name: string; owner_id: string | null }[]).filter(
      (l) => l.name.includes(marker)
    );
    expect(matchingSplit.length).toBe(4);
    for (const l of matchingSplit) cleanupLeadIds.push(l.id);
    const countA = matchingSplit.filter((l) => l.owner_id === targetA.id).length;
    const countB = matchingSplit.filter((l) => l.owner_id === targetB.id).length;
    expect(countA).toBe(2);
    expect(countB).toBe(2);

    // Non-elevated SALES_AGENT cannot assign bulk import to another teammate (403)
    const forbiddenAssign = await api
      .post("/api/v1/leads/bulk")
      .set(auth(nwSalesToken))
      .send({
        importType: "sales",
        assignment: { mode: "single", ownerIds: [targetB.id] },
        rows: [{ director_name: `Forbidden ${marker}`, email: `forb-${marker}@example.com` }],
      });
    expect(forbiddenAssign.status).toBe(403);
  });
});
