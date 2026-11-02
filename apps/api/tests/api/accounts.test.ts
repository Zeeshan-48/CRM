import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_SUPPORT, login } from "../helpers";

// Unique marker so assertions never collide with seeded or concurrent data.
const MARK = "AcctQz77";

let adminToken: string;
let supportToken: string;
let esAdminToken: string;
const createdAccountIds: string[] = [];
const createdContactIds: string[] = [];
const createdDealIds: string[] = [];
const createdContractIds: string[] = [];

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  supportToken = await login(NW_SUPPORT.email, NW_SUPPORT.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  if (createdContractIds.length) {
    await db.deleteFrom("account_contracts").where("id", "in", createdContractIds).execute();
  }
  if (createdDealIds.length) {
    await db.deleteFrom("deals").where("id", "in", createdDealIds).execute();
  }
  if (createdContactIds.length) {
    await db.deleteFrom("contacts").where("id", "in", createdContactIds).execute();
  }
  if (createdAccountIds.length) {
    await db.deleteFrom("accounts").where("id", "in", createdAccountIds).execute();
  }
  await closeDB();
});

describe("accounts module", () => {
  it("lists seeded accounts with SQL-computed stats", async () => {
    const res = await api.get("/api/v1/accounts").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    for (const account of res.body.data) {
      expect(typeof account.contactsCount).toBe("number");
      expect(typeof account.openValue).toBe("number");
    }
    const acme = res.body.data.find((a: { name: string }) => a.name === "Acme Corp");
    expect(acme).toBeTruthy();
    expect(acme.contactsCount).toBeGreaterThanOrEqual(2);
  });

  it("creates an account and requires a name", async () => {
    const missing = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ industry: "EdTech" });
    expect(missing.status).toBe(400);

    const res = await api.post("/api/v1/accounts").set(auth(adminToken)).send({
      name: `${MARK} Pvt Ltd`,
      industry: "EdTech",
      size: "10-50",
      website: "example.com",
      departments: ["Engineering"],
    });
    expect(res.status).toBe(201);
    const account = res.body.data;
    createdAccountIds.push(account.id);
    expect(account.owner_id).toBeTruthy();
    expect(account.departments).toEqual(["Engineering"]);
  });

  it("computes contactsCount and openValue per account", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Stats Co` });
    const account = created.body.data;
    createdAccountIds.push(account.id);

    const contact = await api.post("/api/v1/contacts").set(auth(adminToken)).send({
      name: `${MARK} Buyer`,
      account_id: account.id,
    });
    expect(contact.status).toBe(201);
    createdContactIds.push(contact.body.data.id);

    // Only OPEN deal values count toward openValue.
    const stage = await db
      .selectFrom("stages")
      .select(["id", "pipeline_id"])
      .where("tenant_id", "=", account.tenant_id)
      .executeTakeFirstOrThrow();
    const now = new Date();
    for (const [value, status] of [
      [120000, "OPEN"],
      [999999, "WON"],
    ] as const) {
      const dealId = ulid();
      createdDealIds.push(dealId);
      await db
        .insertInto("deals")
        .values({
          id: dealId,
          tenant_id: account.tenant_id,
          pipeline_id: stage.pipeline_id,
          stage_id: stage.id,
          title: `${MARK} deal ${status}`,
          value,
          account_id: account.id,
          contact_id: contact.body.data.id,
          status,
          created_at: now,
          updated_at: now,
        })
        .execute();
    }

    const list = await api.get("/api/v1/accounts").set(auth(adminToken));
    const mine = list.body.data.find((a: { id: string }) => a.id === account.id);
    expect(mine).toBeTruthy();
    expect(mine.contactsCount).toBe(1);
    expect(mine.openValue).toBe(120000);
  });

  it("returns account detail with contracts, contacts, deals and invoices", async () => {
    const list = await api.get("/api/v1/accounts").set(auth(adminToken));
    const acme = list.body.data.find((a: { name: string }) => a.name === "Acme Corp");

    const res = await api.get(`/api/v1/accounts/${acme.id}`).set(auth(adminToken));
    expect(res.status).toBe(200);
    const detail = res.body.data;
    for (const key of ["contracts", "contacts", "deals", "invoices"]) {
      expect(Array.isArray(detail[key]), `${key} should be an array`).toBe(true);
    }
    expect(detail.contracts.length).toBeGreaterThanOrEqual(1);
    expect(detail.contracts[0].title).toBeTruthy();
    expect(detail.contacts.length).toBeGreaterThanOrEqual(2);
    expect(detail.deals.length).toBeGreaterThanOrEqual(1);
  });

  it("adds contracts with validation and defaults", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Contracts Co` });
    const account = created.body.data;
    createdAccountIds.push(account.id);

    const missingTitle = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(adminToken))
      .send({ value: 1000 });
    expect(missingTitle.status).toBe(400);

    const badStatus = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(adminToken))
      .send({ title: "Bad status", status: "RUNNING" });
    expect(badStatus.status).toBe(400);

    const res = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(adminToken))
      .send({
        title: `${MARK} retainer`,
        value: "150000",
        start_at: "2026-01-01",
        end_at: "2026-12-31",
      });
    expect(res.status).toBe(201);
    const contract = res.body.data;
    createdContractIds.push(contract.id);
    expect(contract.status).toBe("ACTIVE");
    expect(contract.value).toBe(150000);
    expect(contract.start_at).toBeTruthy();
    expect(contract.end_at).toBeTruthy();

    const detail = await api.get(`/api/v1/accounts/${account.id}`).set(auth(adminToken));
    expect(detail.body.data.contracts.length).toBe(1);
    expect(detail.body.data.contracts[0].title).toBe(`${MARK} retainer`);
  });

  it("updates an account, updates and deletes a contract", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Editable Co`, industry: "Old" });
    const account = created.body.data;
    createdAccountIds.push(account.id);

    const upd = await api
      .put(`/api/v1/accounts/${account.id}`)
      .set(auth(adminToken))
      .send({ industry: "NewIndustry", website: "new.example.com" });
    expect(upd.status).toBe(200);
    expect(upd.body.data.industry).toBe("NewIndustry");
    expect(upd.body.data.website).toBe("new.example.com");
    expect(upd.body.data.name).toBe(`${MARK} Editable Co`); // untouched

    const badName = await api
      .put(`/api/v1/accounts/${account.id}`)
      .set(auth(adminToken))
      .send({ name: "  " });
    expect(badName.status).toBe(400);

    const c = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(adminToken))
      .send({ title: `${MARK} c1`, value: 1000 });
    const contractId = c.body.data.id as string;

    const cu = await api
      .put(`/api/v1/accounts/${account.id}/contracts/${contractId}`)
      .set(auth(adminToken))
      .send({ title: `${MARK} c1 renamed`, value: 2500, status: "EXPIRED" });
    expect(cu.status).toBe(200);
    expect(cu.body.data.title).toBe(`${MARK} c1 renamed`);
    expect(cu.body.data.value).toBe(2500);
    expect(cu.body.data.status).toBe("EXPIRED");

    const cd = await api
      .delete(`/api/v1/accounts/${account.id}/contracts/${contractId}`)
      .set(auth(adminToken));
    expect(cd.status).toBe(200);
    const detail = await api.get(`/api/v1/accounts/${account.id}`).set(auth(adminToken));
    expect(
      detail.body.data.contracts.find((x: { id: string }) => x.id === contractId)
    ).toBeFalsy();
  });

  it("deletes an account: cascades contracts, unlinks contacts, keeps the contact", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Deletable Co` });
    const account = created.body.data;

    const contact = await api
      .post("/api/v1/contacts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Del Buyer`, account_id: account.id });
    const contactId = contact.body.data.id as string;
    createdContactIds.push(contactId);

    const c = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(adminToken))
      .send({ title: `${MARK} del c`, value: 500 });
    const contractId = c.body.data.id as string;

    const del = await api.delete(`/api/v1/accounts/${account.id}`).set(auth(adminToken));
    expect(del.status).toBe(200);
    expect(del.body.data.ok).toBe(true);

    const gone = await api.get(`/api/v1/accounts/${account.id}`).set(auth(adminToken));
    expect(gone.status).toBe(404);

    const contractRow = await db
      .selectFrom("account_contracts")
      .select("id")
      .where("id", "=", contractId)
      .executeTakeFirst();
    expect(contractRow).toBeFalsy();

    const contactRow = await db
      .selectFrom("contacts")
      .select(["id", "account_id"])
      .where("id", "=", contactId)
      .executeTakeFirst();
    expect(contactRow).toBeTruthy();
    expect(contactRow?.account_id).toBeNull();

    const again = await api.delete(`/api/v1/accounts/${account.id}`).set(auth(adminToken));
    expect(again.status).toBe(404);
  });

  it("blocks cross-tenant update and delete with 404", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Guard Co` });
    const account = created.body.data;
    createdAccountIds.push(account.id);

    const upd = await api
      .put(`/api/v1/accounts/${account.id}`)
      .set(auth(esAdminToken))
      .send({ name: "hax" });
    expect(upd.status).toBe(404);

    const del = await api.delete(`/api/v1/accounts/${account.id}`).set(auth(esAdminToken));
    expect(del.status).toBe(404);
  });

  it("blocks cross-tenant access with 404", async () => {
    const created = await api
      .post("/api/v1/accounts")
      .set(auth(adminToken))
      .send({ name: `${MARK} Isolated Co` });
    const account = created.body.data;
    createdAccountIds.push(account.id);

    const fetch = await api.get(`/api/v1/accounts/${account.id}`).set(auth(esAdminToken));
    expect(fetch.status).toBe(404);

    const contract = await api
      .post(`/api/v1/accounts/${account.id}/contracts`)
      .set(auth(esAdminToken))
      .send({ title: "Sneaky contract" });
    expect(contract.status).toBe(404);
  });

  it("denies the SUPPORT role access to accounts", async () => {
    const res = await api.get("/api/v1/accounts").set(auth(supportToken));
    expect(res.status).toBe(403);
  });
});
