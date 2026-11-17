import { sql } from "kysely";
import { db } from "../../db/connection";
import { ROLE_MODULES } from "../../constants/modules.const";
import { BadRequestError, NotFoundError } from "../../errors";
import accountsRepository from "../../repositories/accounts.repository";
import contactsRepository from "../../repositories/contacts.repository";
import dealsRepository from "../../repositories/deals.repository";
import financeRepository from "../../repositories/finance.repository";
import leadsRepository from "../../repositories/leads.repository";
import rolesRepository from "../../repositories/roles.repository";
import auditService, { AuditActor } from "./audit.service";

const BUILTIN_ROLE_DEFS = [
  {
    key: "ADMIN",
    name: "Admin",
    description: "Full access to every module, plus settings, billing and audit.",
    permissions: ["*"],
    builtin: true,
  },
  {
    key: "MANAGER",
    name: "Manager",
    description: "Runs the team and all CRM modules except billing, integrations and audit.",
    permissions: ROLE_MODULES.MANAGER,
    builtin: true,
  },
  {
    key: "SALES_AGENT",
    name: "Sales Agent",
    description: "Works leads, deals and contacts through the sales pipeline.",
    permissions: ROLE_MODULES.SALES_AGENT,
    builtin: true,
  },
  {
    key: "SUPPORT_AGENT",
    name: "Support Agent",
    description: "Handles support tickets and customer conversations.",
    permissions: ROLE_MODULES.SUPPORT_AGENT,
    builtin: true,
  },
  {
    key: "MARKETING_AGENT",
    name: "Marketing Agent",
    description: "Runs campaigns, journeys and email / WhatsApp outreach.",
    permissions: ROLE_MODULES.MARKETING_AGENT,
    builtin: true,
  },
  {
    key: "HR",
    name: "HR",
    description: "Access to the knowledge base and calendar.",
    permissions: ROLE_MODULES.HR,
    builtin: true,
  },
  {
    key: "FINANCE",
    name: "Finance",
    description: "Invoicing, payments and financial analytics.",
    permissions: ROLE_MODULES.FINANCE,
    builtin: true,
  },
];

export interface VaultSummary {
  leads: { total: number; active: number; deleted: number };
  contacts: { total: number; active: number; deleted: number };
  deals: { total: number; active: number; deleted: number };
  accounts: { total: number; active: number; deleted: number };
  contracts: { total: number; active: number; deleted: number };
  invoices: { total: number; active: number; deleted: number };
  roles: { total: number; active: number; deleted: number };
  users: number;
}

class VaultService {
  async summary(tenantId?: string): Promise<VaultSummary> {
    const filterTenant = (eb: any) =>
      tenantId ? eb("tenant_id", "=", tenantId) : sql`1=1`;

    const [
      leadsStats,
      contactsStats,
      dealsStats,
      accountsStats,
      contractsStats,
      invoicesStats,
      rolesStats,
      usersCount,
    ] = await Promise.all([
      db
        .selectFrom("leads")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("contacts")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("deals")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("accounts")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("account_contracts")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("invoices")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("roles")
        .select([
          sql<number>`count(*)`.as("total"),
          sql<number>`count(*) filter (where deleted_at is null)`.as("active"),
          sql<number>`count(*) filter (where deleted_at is not null)`.as("deleted"),
        ])
        .where(filterTenant)
        .executeTakeFirst(),
      db
        .selectFrom("users")
        .select(sql<number>`count(*)`.as("total"))
        .where(filterTenant)
        .executeTakeFirst(),
    ]);

    return {
      leads: {
        total: Number(leadsStats?.total || 0),
        active: Number(leadsStats?.active || 0),
        deleted: Number(leadsStats?.deleted || 0),
      },
      contacts: {
        total: Number(contactsStats?.total || 0),
        active: Number(contactsStats?.active || 0),
        deleted: Number(contactsStats?.deleted || 0),
      },
      deals: {
        total: Number(dealsStats?.total || 0),
        active: Number(dealsStats?.active || 0),
        deleted: Number(dealsStats?.deleted || 0),
      },
      accounts: {
        total: Number(accountsStats?.total || 0),
        active: Number(accountsStats?.active || 0),
        deleted: Number(accountsStats?.deleted || 0),
      },
      contracts: {
        total: Number(contractsStats?.total || 0),
        active: Number(contractsStats?.active || 0),
        deleted: Number(contractsStats?.deleted || 0),
      },
      invoices: {
        total: Number(invoicesStats?.total || 0),
        active: Number(invoicesStats?.active || 0),
        deleted: Number(invoicesStats?.deleted || 0),
      },
      roles: {
        total: Number(rolesStats?.total || 0) + BUILTIN_ROLE_DEFS.length,
        active: Number(rolesStats?.active || 0) + BUILTIN_ROLE_DEFS.length,
        deleted: Number(rolesStats?.deleted || 0),
      },
      users: Number(usersCount?.total || 0),
    };
  }

  async getData(params: {
    tenantId?: string;
    entity: string;
    filter?: "all" | "active" | "deleted";
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, params.page || 1);
    const limit = Math.min(200, Math.max(1, params.limit || 50));
    const offset = (page - 1) * limit;
    const { tenantId, entity, filter = "all", q } = params;

    const applyStatus = (query: any) => {
      if (filter === "active") return query.where("deleted_at", "is", null);
      if (filter === "deleted") return query.where("deleted_at", "is not", null);
      return query;
    };

    const applyTenant = (query: any) => {
      if (tenantId) return query.where("tenant_id", "=", tenantId);
      return query;
    };

    switch (entity) {
      case "leads": {
        let base = applyStatus(applyTenant(db.selectFrom("leads")));
        if (q) {
          const s = `%${q}%`;
          base = base.where((eb: any) =>
            eb.or([eb("name", "ilike", s), eb("email", "ilike", s), eb("phone", "ilike", s), eb("city", "ilike", s)])
          );
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "contacts": {
        let base = applyStatus(applyTenant(db.selectFrom("contacts")));
        if (q) {
          const s = `%${q}%`;
          base = base.where((eb: any) =>
            eb.or([eb("name", "ilike", s), eb("email", "ilike", s), eb("phone", "ilike", s), eb("company", "ilike", s)])
          );
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "deals": {
        let base = applyStatus(applyTenant(db.selectFrom("deals")));
        if (q) {
          const s = `%${q}%`;
          base = base.where("title", "ilike", s);
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "accounts": {
        let base = applyStatus(applyTenant(db.selectFrom("accounts")));
        if (q) {
          const s = `%${q}%`;
          base = base.where((eb: any) =>
            eb.or([eb("name", "ilike", s), eb("industry", "ilike", s), eb("project_name", "ilike", s)])
          );
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "contracts": {
        let base = applyStatus(applyTenant(db.selectFrom("account_contracts")));
        if (q) {
          const s = `%${q}%`;
          base = base.where("title", "ilike", s);
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "invoices": {
        let base = applyStatus(applyTenant(db.selectFrom("invoices")));
        if (q) {
          const s = `%${q}%`;
          base = base.where("number", "ilike", s);
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "roles": {
        // 1. Fetch users per role for this tenant (or all tenants)
        let usersQuery = db
          .selectFrom("users")
          .select(["id", "tenant_id", "name", "email", "phone", "role", "status", "avatar_color"]);
        if (tenantId) {
          usersQuery = usersQuery.where("tenant_id", "=", tenantId);
        }
        const userRows = await usersQuery.execute();
        const roleUsersMap = new Map<
          string,
          Array<{ id: string; name: string; email: string; phone?: string | null; status: string }>
        >();
        for (const u of userRows) {
          const list = roleUsersMap.get(u.role) || [];
          list.push({
            id: u.id,
            name: u.name,
            email: u.email,
            phone: u.phone,
            status: u.status,
          });
          roleUsersMap.set(u.role, list);
        }

        // 2. Fetch custom roles from database
        let base = applyStatus(applyTenant(db.selectFrom("roles")));
        if (q) {
          const s = `%${q}%`;
          base = base.where((eb: any) => eb.or([eb("name", "ilike", s), eb("key", "ilike", s)]));
        }
        const customRolesTotal = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const customRows = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .execute();

        const customItems = customRows.map((r: any) => {
          const members = roleUsersMap.get(r.key) || [];
          return {
            ...r,
            builtin: false,
            member_count: members.length,
            members,
          };
        });

        // 3. Built-in roles (only included when filter is 'all' or 'active', never 'deleted')
        let builtinItems: any[] = [];
        if (filter !== "deleted") {
          builtinItems = BUILTIN_ROLE_DEFS.map((b) => {
            const members = roleUsersMap.get(b.key) || [];
            return {
              id: `builtin_${b.key.toLowerCase()}`,
              tenant_id: tenantId || "ALL_TENANTS",
              key: b.key,
              name: b.name,
              description: b.description,
              permissions: b.permissions,
              builtin: true,
              member_count: members.length,
              members,
              created_at: new Date(0),
              updated_at: new Date(0),
              deleted_at: null,
              deleted_by: null,
            };
          });

          if (q) {
            const lower = q.toLowerCase();
            builtinItems = builtinItems.filter(
              (b) =>
                b.name.toLowerCase().includes(lower) ||
                b.key.toLowerCase().includes(lower) ||
                b.members.some(
                  (m: any) =>
                    m.name.toLowerCase().includes(lower) ||
                    m.email.toLowerCase().includes(lower)
                )
            );
          }
        }

        const allItems = [...customItems, ...builtinItems];
        const total = (filter === "deleted" ? 0 : builtinItems.length) + Number(customRolesTotal?.count || 0);

        const items = allItems.slice(offset, offset + limit);
        return { items, total, page, limit };
      }

      case "users": {
        let base = applyTenant(db.selectFrom("users"));
        if (q) {
          const s = `%${q}%`;
          base = base.where((eb: any) => eb.or([eb("name", "ilike", s), eb("email", "ilike", s), eb("role", "ilike", s)]));
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .select(["id", "tenant_id", "name", "email", "role", "status", "last_login_at", "created_at"])
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      case "activities": {
        let base = applyTenant(db.selectFrom("activities"));
        if (q) {
          const s = `%${q}%`;
          base = base.where("title", "ilike", s);
        }
        const total = await base.select(sql<number>`count(*)`.as("count")).executeTakeFirst();
        const items = await base
          .selectAll()
          .orderBy("created_at", "desc")
          .limit(limit)
          .offset(offset)
          .execute();
        return { items, total: Number(total?.count || 0), page, limit };
      }

      default:
        throw new BadRequestError(`Invalid entity: ${entity}`);
    }
  }

  async restoreItem(actor: AuditActor, tenantId: string, entity: string, id: string) {
    let success = false;
    switch (entity) {
      case "leads":
        success = await leadsRepository.restore(id, tenantId);
        break;
      case "contacts":
        success = await contactsRepository.restore(id, tenantId);
        break;
      case "deals":
        success = await dealsRepository.restoreDeal(id, tenantId);
        break;
      case "accounts":
        success = await accountsRepository.restore(id, tenantId);
        break;
      case "contracts": {
        const contract = await db
          .selectFrom("account_contracts")
          .select(["account_id"])
          .where("id", "=", id)
          .where("tenant_id", "=", tenantId)
          .executeTakeFirst();
        if (contract) {
          success = await accountsRepository.restoreContract(id, contract.account_id, tenantId);
        }
        break;
      }
      case "invoices":
        success = await financeRepository.restoreInvoice(id, tenantId);
        break;
      case "roles": {
        const role = await db
          .selectFrom("roles")
          .select(["key"])
          .where("id", "=", id)
          .where("tenant_id", "=", tenantId)
          .executeTakeFirst();
        if (role) {
          success = (await rolesRepository.restore(tenantId, role.key)) > 0;
        }
        break;
      }
      default:
        throw new BadRequestError(`Entity cannot be restored: ${entity}`);
    }

    if (!success) {
      throw new NotFoundError(`Record not found or already active in ${entity}`);
    }

    auditService.log(actor, "vault.restore", "tenant", {
      tenantId,
      resourceId: id,
      summary: `Restored ${entity} record (${id}) for tenant ${tenantId}`,
      metadata: { entity, id },
    });

    return { ok: true, message: `Successfully restored ${entity} record.` };
  }

  async purgeItem(actor: AuditActor, tenantId: string, entity: string, id: string) {
    let numDeleted = 0;
    switch (entity) {
      case "leads": {
        const res = await db.deleteFrom("leads").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "contacts": {
        const res = await db.deleteFrom("contacts").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "deals": {
        const res = await db.deleteFrom("deals").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "accounts": {
        await db.deleteFrom("account_contracts").where("account_id", "=", id).where("tenant_id", "=", tenantId).execute();
        const res = await db.deleteFrom("accounts").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "contracts": {
        const res = await db.deleteFrom("account_contracts").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "invoices": {
        await db.deleteFrom("payments").where("invoice_id", "=", id).where("tenant_id", "=", tenantId).execute();
        const res = await db.deleteFrom("invoices").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      case "roles": {
        const res = await db.deleteFrom("roles").where("id", "=", id).where("tenant_id", "=", tenantId).executeTakeFirst();
        numDeleted = Number(res?.numDeletedRows || 0);
        break;
      }
      default:
        throw new BadRequestError(`Entity cannot be purged: ${entity}`);
    }

    if (numDeleted === 0) {
      throw new NotFoundError(`Record not found in ${entity}`);
    }

    auditService.log(actor, "vault.purge", "tenant", {
      tenantId,
      resourceId: id,
      summary: `Permanently purged ${entity} record (${id}) for tenant ${tenantId}`,
      metadata: { entity, id },
    });

    return { ok: true, message: `Permanently purged ${entity} record.` };
  }
}

export default new VaultService();

