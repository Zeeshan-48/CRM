import { contract_status } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import { assertCanManageRecord } from "../utils/record-policy";
import accountsRepository, {
  AccountContractRow,
  AccountRow,
} from "../repositories/accounts.repository";
import engineService from "./engine.service";

const CONTRACT_STATUSES = Object.values(contract_status);

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const asContractStatus = (value: unknown): contract_status | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !CONTRACT_STATUSES.includes(value as contract_status)) {
    throw new BadRequestError(`status must be one of ${CONTRACT_STATUSES.join(", ")}`);
  }
  return value as contract_status;
};

const asDate = (value: unknown, field: string): Date | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadRequestError(`${field} must be a date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestError(`${field} must be a valid date`);
  return date;
};

class AccountsService {
  async list(tenantId: string) {
    const rows = await accountsRepository.listWithStats(tenantId);
    return rows.map(({ contactsCount, openValue, hasOverdue, hasAmcDue, contractsCount, ...account }) => ({
      ...account,
      contactsCount: Number(contactsCount ?? 0),
      openValue: Number(openValue ?? 0),
      hasOverdue: Boolean(hasOverdue),
      hasAmcDue: Boolean(hasAmcDue),
      contractsCount: Number(contractsCount ?? 0),
    }));
  }

  async detail(tenantId: string, accountId: string) {
    const account = await accountsRepository.findById(accountId, tenantId);
    if (!account) throw new NotFoundError("Account not found");
    const relations = await accountsRepository.detailRelations(tenantId, accountId);
    return { ...account, ...relations };
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      name?: string;
      project_name?: string;
      industry?: string;
      size?: string;
      website?: string;
      owner_id?: string;
      departments?: unknown;
      address?: string;
      city?: string;
      state?: string;
      pincode?: string;
      gstin?: string;
      phone?: string;
      email?: string;
    }
  ): Promise<AccountRow> {
    if (!body.name) throw new BadRequestError("name is required");

    const account = await accountsRepository.create({
      tenant_id: tenantId,
      name: body.name,
      project_name: body.project_name,
      industry: body.industry,
      size: body.size,
      website: body.website,
      owner_id: body.owner_id ?? actorId,
      departments: parseStringArray(body.departments),
      address: body.address,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      gstin: body.gstin,
      phone: body.phone,
      email: body.email,
    });

    engineService.audit(tenantId, actorId, "account.created", "account", account.id, {});
    return account;
  }

  async addContract(
    tenantId: string,
    actorId: string,
    accountId: string,
    body: {
      title?: string;
      value?: unknown;
      status?: string;
      billing_type?: string;
      recurring_interval?: string;
      recurring_value?: unknown;
      milestones?: unknown;
      start_at?: unknown;
      end_at?: unknown;
    }
  ): Promise<AccountContractRow> {
    const account = await accountsRepository.findById(accountId, tenantId);
    if (!account) throw new NotFoundError("Account not found");
    if (!body.title) throw new BadRequestError("title required");

    const billingType = body.billing_type === "RECURRING" || body.billing_type === "HYBRID" ? body.billing_type : "ONE_TIME";
    const recurringInterval = body.recurring_interval === "MONTHLY" ? "MONTHLY" : "ANNUAL";
    const recurringValue = Math.round(Number(body.recurring_value)) || 0;
    const milestones = Array.isArray(body.milestones) ? body.milestones : [];

    const contract = await accountsRepository.addContract({
      tenant_id: tenantId,
      account_id: accountId,
      title: body.title,
      value: Math.round(Number(body.value)) || 0,
      status: asContractStatus(body.status),
      billing_type: billingType,
      recurring_interval: recurringInterval,
      recurring_value: recurringValue,
      milestones,
      start_at: asDate(body.start_at, "start_at"),
      end_at: asDate(body.end_at, "end_at"),
    });

    engineService.audit(tenantId, actorId, "account.contract_added", "account", accountId, {
      contractId: contract.id,
      title: contract.title,
    });
    return contract;
  }

  async update(
    tenantId: string,
    actorId: string,
    accountId: string,
    body: {
      name?: string;
      project_name?: string;
      industry?: string;
      size?: string;
      website?: string;
      owner_id?: string | null;
      departments?: unknown;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      pincode?: string | null;
      gstin?: string | null;
      phone?: string | null;
      email?: string | null;
    }
  ): Promise<AccountRow> {
    const account = await accountsRepository.findById(accountId, tenantId);
    if (!account) throw new NotFoundError("Account not found");
    if (body.name !== undefined && !String(body.name).trim()) {
      throw new BadRequestError("name cannot be empty");
    }

    const updated = await accountsRepository.update(accountId, tenantId, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      project_name: body.project_name !== undefined ? body.project_name : undefined,
      industry: body.industry,
      size: body.size,
      website: body.website,
      owner_id: body.owner_id,
      departments: body.departments !== undefined ? parseStringArray(body.departments) : undefined,
      address: body.address,
      city: body.city,
      state: body.state,
      pincode: body.pincode,
      gstin: body.gstin,
      phone: body.phone,
      email: body.email,
    });
    if (!updated) throw new NotFoundError("Account not found");

    engineService.audit(tenantId, actorId, "account.updated", "account", accountId, {});
    return updated;
  }

  async remove(tenantId: string, actorId: string, actorRole: string, accountId: string) {
    const account = await accountsRepository.findById(accountId, tenantId);
    if (!account) throw new NotFoundError("Account not found");
    assertCanManageRecord(actorId, actorRole, account.owner_id, "delete", "account");
    await accountsRepository.delete(accountId, tenantId);
    engineService.audit(tenantId, actorId, "account.deleted", "account", accountId, {});
    return { ok: true };
  }

  async updateContract(
    tenantId: string,
    actorId: string,
    accountId: string,
    contractId: string,
    body: {
      title?: string;
      value?: unknown;
      status?: string;
      billing_type?: string;
      recurring_interval?: string;
      recurring_value?: unknown;
      milestones?: unknown;
      start_at?: unknown;
      end_at?: unknown;
    }
  ): Promise<AccountContractRow> {
    const contract = await accountsRepository.findContractById(contractId, accountId, tenantId);
    if (!contract) throw new NotFoundError("Contract not found");
    if (body.title !== undefined && !String(body.title).trim()) {
      throw new BadRequestError("title cannot be empty");
    }

    const updated = await accountsRepository.updateContract(contractId, accountId, tenantId, {
      title: body.title !== undefined ? String(body.title).trim() : undefined,
      value: body.value !== undefined ? Math.round(Number(body.value)) || 0 : undefined,
      status: asContractStatus(body.status),
      billing_type: body.billing_type !== undefined ? body.billing_type : undefined,
      recurring_interval: body.recurring_interval !== undefined ? body.recurring_interval : undefined,
      recurring_value: body.recurring_value !== undefined ? Math.round(Number(body.recurring_value)) || 0 : undefined,
      milestones: body.milestones !== undefined ? (Array.isArray(body.milestones) ? body.milestones : []) : undefined,
      start_at: body.start_at !== undefined ? asDate(body.start_at, "start_at") : undefined,
      end_at: body.end_at !== undefined ? asDate(body.end_at, "end_at") : undefined,
    });
    if (!updated) throw new NotFoundError("Contract not found");

    engineService.audit(tenantId, actorId, "account.contract_updated", "account", accountId, {
      contractId,
    });
    return updated;
  }

  async removeContract(
    tenantId: string,
    actorId: string,
    accountId: string,
    contractId: string
  ) {
    const contract = await accountsRepository.findContractById(contractId, accountId, tenantId);
    if (!contract) throw new NotFoundError("Contract not found");
    await accountsRepository.deleteContract(contractId, accountId, tenantId);
    engineService.audit(tenantId, actorId, "account.contract_deleted", "account", accountId, {
      contractId,
    });
    return { ok: true };
  }
}

export default new AccountsService();
