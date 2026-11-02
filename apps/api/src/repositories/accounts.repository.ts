import { Selectable, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { contract_status } from "../db/enums";
import type { DB, account_contracts, accounts } from "../db/types";

export type AccountRow = Selectable<accounts>;
export type AccountContractRow = Selectable<account_contracts>;

export interface CreateAccountData {
  tenant_id: string;
  name: string;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  owner_id?: string | null;
  departments?: string[];
}

export interface AddContractData {
  tenant_id: string;
  account_id: string;
  deal_id?: string | null;
  title: string;
  value?: number;
  status?: contract_status;
  start_at?: Date | null;
  end_at?: Date | null;
}

export interface UpdateAccountData {
  name?: string;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  owner_id?: string | null;
  departments?: string[];
}

export interface UpdateContractData {
  title?: string;
  value?: number;
  status?: contract_status;
  start_at?: Date | null;
  end_at?: Date | null;
}

class AccountsRepository {
  // Per-account contact count and open pipeline value computed in SQL.
  async listWithStats(tenantId: string) {
    return db
      .selectFrom("accounts")
      .selectAll("accounts")
      .select((eb) => [
        eb
          .selectFrom("contacts")
          .select((seb) => seb.fn.count<number>("contacts.id").as("n"))
          .whereRef("contacts.account_id", "=", "accounts.id")
          .where("contacts.tenant_id", "=", tenantId)
          .as("contactsCount"),
        eb
          .selectFrom("deals")
          .select((seb) => seb.fn.sum<number>("deals.value").as("s"))
          .whereRef("deals.account_id", "=", "accounts.id")
          .where("deals.tenant_id", "=", tenantId)
          .where("deals.status", "=", "OPEN")
          .as("openValue"),
      ])
      .where("accounts.tenant_id", "=", tenantId)
      .orderBy("accounts.created_at", "asc")
      .orderBy("accounts.id", "asc")
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<AccountRow | undefined> {
    return db
      .selectFrom("accounts")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: CreateAccountData, trx?: Transaction<DB>): Promise<AccountRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("accounts")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        industry: data.industry ?? "",
        size: data.size ?? "",
        website: data.website ?? "",
        owner_id: data.owner_id ?? null,
        departments: JSON.stringify(data.departments ?? []),
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async detailRelations(tenantId: string, accountId: string) {
    const [contracts, contacts, deals, invoices] = await Promise.all([
      this.contracts(tenantId, accountId),
      db
        .selectFrom("contacts")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("account_id", "=", accountId)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("deals")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("account_id", "=", accountId)
        .orderBy("created_at", "desc")
        .execute(),
      db
        .selectFrom("invoices")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .where("account_id", "=", accountId)
        .orderBy("created_at", "desc")
        .execute(),
    ]);
    return { contracts, contacts, deals, invoices };
  }

  async contracts(tenantId: string, accountId: string): Promise<AccountContractRow[]> {
    return db
      .selectFrom("account_contracts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("account_id", "=", accountId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
  }

  async addContract(data: AddContractData, trx?: Transaction<DB>): Promise<AccountContractRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("account_contracts")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        account_id: data.account_id,
        deal_id: data.deal_id ?? null,
        title: data.title,
        value: data.value ?? 0,
        status: data.status ?? "ACTIVE",
        start_at: data.start_at ?? null,
        end_at: data.end_at ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    tenantId: string,
    data: UpdateAccountData
  ): Promise<AccountRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.industry !== undefined) patch.industry = data.industry ?? "";
    if (data.size !== undefined) patch.size = data.size ?? "";
    if (data.website !== undefined) patch.website = data.website ?? "";
    if (data.owner_id !== undefined) patch.owner_id = data.owner_id;
    if (data.departments !== undefined) patch.departments = JSON.stringify(data.departments);
    return db
      .updateTable("accounts")
      .set(patch)
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  // Deletes the account and its contracts (FK cascade). Contacts/deals/invoices
  // reference the account without a DB FK, so their account_id is cleared first
  // to avoid dangling links in the UI.
  async delete(id: string, tenantId: string): Promise<boolean> {
    return db.transaction().execute(async (trx) => {
      for (const table of ["contacts", "deals", "invoices"] as const) {
        await trx
          .updateTable(table)
          .set({ account_id: null })
          .where("account_id", "=", id)
          .where("tenant_id", "=", tenantId)
          .execute();
      }
      const result = await trx
        .deleteFrom("accounts")
        .where("id", "=", id)
        .where("tenant_id", "=", tenantId)
        .executeTakeFirst();
      return Number(result?.numDeletedRows ?? 0) > 0;
    });
  }

  async findContractById(
    contractId: string,
    accountId: string,
    tenantId: string
  ): Promise<AccountContractRow | undefined> {
    return db
      .selectFrom("account_contracts")
      .selectAll()
      .where("id", "=", contractId)
      .where("account_id", "=", accountId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // Idempotency lookup for the won-deal → contract automation: is there
  // already a contract sourced from this deal?
  async findContractByDeal(
    tenantId: string,
    dealId: string
  ): Promise<AccountContractRow | undefined> {
    return db
      .selectFrom("account_contracts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("deal_id", "=", dealId)
      .executeTakeFirst();
  }

  async updateContract(
    contractId: string,
    accountId: string,
    tenantId: string,
    data: UpdateContractData
  ): Promise<AccountContractRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.title !== undefined) patch.title = data.title;
    if (data.value !== undefined) patch.value = data.value;
    if (data.status !== undefined) patch.status = data.status;
    if (data.start_at !== undefined) patch.start_at = data.start_at;
    if (data.end_at !== undefined) patch.end_at = data.end_at;
    return db
      .updateTable("account_contracts")
      .set(patch)
      .where("id", "=", contractId)
      .where("account_id", "=", accountId)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteContract(
    contractId: string,
    accountId: string,
    tenantId: string
  ): Promise<boolean> {
    const result = await db
      .deleteFrom("account_contracts")
      .where("id", "=", contractId)
      .where("account_id", "=", accountId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }
}

export default new AccountsRepository();
