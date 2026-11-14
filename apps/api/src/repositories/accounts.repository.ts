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
  project_name?: string | null;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  owner_id?: string | null;
  departments?: string[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface AddContractData {
  tenant_id: string;
  account_id: string;
  deal_id?: string | null;
  title: string;
  value?: number;
  status?: contract_status;
  billing_type?: string;
  recurring_interval?: string | null;
  recurring_value?: number;
  milestones?: unknown;
  start_at?: Date | null;
  end_at?: Date | null;
}

export interface UpdateAccountData {
  name?: string;
  project_name?: string | null;
  industry?: string | null;
  size?: string | null;
  website?: string | null;
  owner_id?: string | null;
  departments?: string[];
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface UpdateContractData {
  title?: string;
  value?: number;
  status?: contract_status;
  billing_type?: string;
  recurring_interval?: string | null;
  recurring_value?: number;
  milestones?: unknown;
  start_at?: Date | null;
  end_at?: Date | null;
}

class AccountsRepository {
  // Per-account contact count, open pipeline value, and contract overdue/AMC alerts.
  async listWithStats(tenantId: string) {
    const [accounts, allContracts] = await Promise.all([
      db
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
        .execute(),
      db
        .selectFrom("account_contracts")
        .selectAll()
        .where("tenant_id", "=", tenantId)
        .execute(),
    ]);

    const contractsByAccount = new Map<string, AccountContractRow[]>();
    for (const raw of allContracts) {
      const contract = this.parseContract(raw)!;
      const list = contractsByAccount.get(contract.account_id) || [];
      list.push(contract);
      contractsByAccount.set(contract.account_id, list);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return accounts.map((account) => {
      const contracts = contractsByAccount.get(account.id) || [];
      let hasOverdue = false;
      let hasAmcDue = false;

      for (const contract of contracts) {
        if (contract.status !== "ACTIVE") continue;
        const milestones = (contract.milestones as any[]) || [];
        for (const m of milestones) {
          if (m.status !== "PAID" && m.due_at) {
            const dueDate = new Date(m.due_at);
            if (dueDate <= today) {
              hasOverdue = true;
              if (m.is_recurring) {
                hasAmcDue = true;
              }
            }
          }
        }
      }

      return {
        ...account,
        contractsCount: contracts.length,
        hasOverdue,
        hasAmcDue,
      };
    });
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
        project_name: data.project_name ?? null,
        industry: data.industry ?? "",
        size: data.size ?? "",
        website: data.website ?? "",
        owner_id: data.owner_id ?? null,
        departments: JSON.stringify(data.departments ?? []),
        address: data.address ?? null,
        city: data.city ?? null,
        state: data.state ?? null,
        pincode: data.pincode ?? null,
        gstin: data.gstin ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
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

  private parseContract(row: AccountContractRow | undefined): AccountContractRow | undefined {
    if (!row) return undefined;
    let milestones = row.milestones;
    if (typeof milestones === "string") {
      try {
        milestones = JSON.parse(milestones);
      } catch {
        milestones = [];
      }
    }
    const billingType = row.billing_type || "ONE_TIME";
    const recurringInterval = row.recurring_interval || "ANNUAL";
    const recurringValue = Number(row.recurring_value || 0);
    const parsedMilestones = (Array.isArray(milestones) ? [...milestones] : []) as any[];

    // Auto-schedule next recurring cycle if needed
    if (recurringValue > 0) {
      const recurringMilestones = parsedMilestones.filter((m: any) => m.is_recurring);
      if (recurringMilestones.length === 0) {
        // First AMC milestone if none exists
        const startDate = row.start_at ? new Date(row.start_at) : new Date(row.created_at);
        const dueDate = row.end_at ? new Date(row.end_at) : new Date(startDate);
        if (!row.end_at) {
          if (recurringInterval === "MONTHLY") {
            dueDate.setMonth(dueDate.getMonth() + 1);
          } else {
            dueDate.setFullYear(dueDate.getFullYear() + 1);
          }
        }
        parsedMilestones.push({
          id: `m_rec_1_${row.id.slice(-6)}`,
          name: `${recurringInterval === "MONTHLY" ? "Monthly" : "Annual"} Support & Maintenance (Period 1)`,
          amount: recurringValue,
          due_at: dueDate.toISOString().slice(0, 10),
          status: "PENDING",
          is_recurring: true,
        });
      } else {
        // Check if next cycle should be scheduled.
        // Cycle is scheduled if:
        // 1. Latest cycle is marked PAID
        // 2. OR previous cycle's due date has already passed (1 year / 1 month completed),
        //    even if UNPAID/PENDING! This guarantees overdue cycles accumulate (Year 1 Overdue + Year 2 Due).
        let latestRec = recurringMilestones[recurringMilestones.length - 1];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let guard = 0;
        while (latestRec && latestRec.due_at && guard < 5) {
          guard++;
          const lastDueDate = new Date(latestRec.due_at);
          const nextDueDate = new Date(lastDueDate);
          if (recurringInterval === "MONTHLY") {
            nextDueDate.setMonth(nextDueDate.getMonth() + 1);
          } else {
            nextDueDate.setFullYear(nextDueDate.getFullYear() + 1);
          }

          const cyclePassed = lastDueDate <= today;
          const isPaid = latestRec.status === "PAID";

          if (!cyclePassed && !isPaid) {
            break;
          }

          const nextIndex = recurringMilestones.length + 1;
          const periodLabel = recurringInterval === "MONTHLY" ? `Month ${nextIndex}` : `Year ${nextIndex}`;
          const newMilestone = {
            id: `m_rec_${nextIndex}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: `${recurringInterval === "MONTHLY" ? "Monthly" : "Annual"} Support & Maintenance (${periodLabel})`,
            amount: recurringValue,
            base_amount: latestRec.base_amount,
            tax_amount: latestRec.tax_amount,
            tax_rate: latestRec.tax_rate,
            due_at: nextDueDate.toISOString().slice(0, 10),
            status: "PENDING",
            is_recurring: true,
          };

          parsedMilestones.push(newMilestone);
          recurringMilestones.push(newMilestone);
          latestRec = newMilestone;

          // If the newly added cycle is due in the future, stop queueing further iterations
          if (nextDueDate > today) {
            break;
          }
        }
      }
    }

    if (row && parsedMilestones.length !== (Array.isArray(milestones) ? milestones.length : 0)) {
      db.updateTable("account_contracts")
        .set({ milestones: JSON.stringify(parsedMilestones), updated_at: new Date() })
        .where("id", "=", row.id)
        .execute()
        .catch(() => {});
    }

    return {
      ...row,
      billing_type: billingType,
      recurring_interval: recurringInterval,
      recurring_value: recurringValue,
      milestones: parsedMilestones as any,
    };
  }

  async contracts(tenantId: string, accountId: string): Promise<AccountContractRow[]> {
    const rows = await db
      .selectFrom("account_contracts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("account_id", "=", accountId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((r) => this.parseContract(r)!);
  }

  async addContract(data: AddContractData, trx?: Transaction<DB>): Promise<AccountContractRow> {
    const now = new Date();
    const row = await (trx || db)
      .insertInto("account_contracts")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        account_id: data.account_id,
        deal_id: data.deal_id ?? null,
        title: data.title,
        value: data.value ?? 0,
        status: data.status ?? "ACTIVE",
        billing_type: data.billing_type ?? "ONE_TIME",
        recurring_interval: data.recurring_interval ?? "ANNUAL",
        recurring_value: data.recurring_value ?? 0,
        milestones: JSON.stringify(data.milestones ?? []),
        start_at: data.start_at ?? null,
        end_at: data.end_at ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.parseContract(row)!;
  }

  async update(
    id: string,
    tenantId: string,
    data: UpdateAccountData
  ): Promise<AccountRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.project_name !== undefined) patch.project_name = data.project_name;
    if (data.industry !== undefined) patch.industry = data.industry ?? "";
    if (data.size !== undefined) patch.size = data.size ?? "";
    if (data.website !== undefined) patch.website = data.website ?? "";
    if (data.owner_id !== undefined) patch.owner_id = data.owner_id;
    if (data.departments !== undefined) patch.departments = JSON.stringify(data.departments);
    if (data.address !== undefined) patch.address = data.address;
    if (data.city !== undefined) patch.city = data.city;
    if (data.state !== undefined) patch.state = data.state;
    if (data.pincode !== undefined) patch.pincode = data.pincode;
    if (data.gstin !== undefined) patch.gstin = data.gstin;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email;
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
    const row = await db
      .selectFrom("account_contracts")
      .selectAll()
      .where("id", "=", contractId)
      .where("account_id", "=", accountId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return this.parseContract(row);
  }

  // Idempotency lookup for the won-deal → contract automation: is there
  // already a contract sourced from this deal?
  async findContractByDeal(
    tenantId: string,
    dealId: string
  ): Promise<AccountContractRow | undefined> {
    const row = await db
      .selectFrom("account_contracts")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("deal_id", "=", dealId)
      .executeTakeFirst();
    return this.parseContract(row);
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
    if (data.billing_type !== undefined) patch.billing_type = data.billing_type;
    if (data.recurring_interval !== undefined) patch.recurring_interval = data.recurring_interval;
    if (data.recurring_value !== undefined) patch.recurring_value = data.recurring_value;
    if (data.milestones !== undefined) {
      patch.milestones = typeof data.milestones === "string" ? data.milestones : JSON.stringify(data.milestones);
    }
    if (data.start_at !== undefined) patch.start_at = data.start_at;
    if (data.end_at !== undefined) patch.end_at = data.end_at;
    const row = await db
      .updateTable("account_contracts")
      .set(patch)
      .where("id", "=", contractId)
      .where("account_id", "=", accountId)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
    return this.parseContract(row);
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
