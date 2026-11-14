import { apiDelete, apiGet, apiPost, apiPut } from "./client";
import type { Contact, Invoice } from "./contacts";
import type { Deal } from "./deals";

export type ContractStatus = "ACTIVE" | "INACTIVE" | "EXPIRED";
export type BillingType = "ONE_TIME" | "RECURRING" | "HYBRID";
export type RecurringInterval = "ANNUAL" | "MONTHLY";

export interface ContractMilestone {
  id: string;
  name: string;
  amount: number;
  base_amount?: number;
  tax_amount?: number;
  tax_rate?: number;
  due_at: string | null;
  status: "PAID" | "PENDING" | "OVERDUE";
  paid_at?: string | null;
  paid_method?: string | null;
  is_recurring?: boolean;
}

export interface Account {
  id: string;
  tenant_id: string;
  name: string;
  industry: string | null;
  size: string | null;
  website: string | null;
  project_name?: string | null;
  owner_id: string | null;
  departments: string[] | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  created_at: string;
  updated_at: string;
}

/** GET /accounts rows carry aggregate stats. */
export interface AccountWithStats extends Account {
  contactsCount: number;
  openValue: number;
  hasOverdue?: boolean;
  hasAmcDue?: boolean;
  contractsCount?: number;
}

export interface AccountContract {
  id: string;
  tenant_id: string;
  account_id: string;
  /** Set when auto-created from a won deal. */
  deal_id: string | null;
  title: string;
  value: number;
  status: ContractStatus;
  billing_type: BillingType;
  recurring_interval: RecurringInterval | null;
  recurring_value: number;
  milestones: ContractMilestone[];
  start_at: string | null;
  end_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountDetail extends Account {
  contracts: AccountContract[];
  contacts: Contact[];
  deals: Deal[];
  invoices: Invoice[];
}

export const listAccounts = () => apiGet<AccountWithStats[]>("/accounts");

export const getAccount = (id: string) => apiGet<AccountDetail>(`/accounts/${id}`);

export const createAccount = (body: {
  name: string;
  industry?: string;
  size?: string;
  website?: string;
  project_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gstin?: string;
  phone?: string;
  email?: string;
}) => apiPost<Account>("/accounts", body);

export const updateAccount = (
  id: string,
  body: {
    name?: string;
    industry?: string;
    size?: string;
    website?: string;
    project_name?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    gstin?: string;
    phone?: string;
    email?: string;
  }
) => apiPut<Account>(`/accounts/${id}`, body);

export const deleteAccount = (id: string) => apiDelete<{ ok: boolean }>(`/accounts/${id}`);

export const addContract = (
  accountId: string,
  body: {
    title: string;
    value: number;
    status?: ContractStatus;
    billing_type?: BillingType;
    recurring_interval?: RecurringInterval;
    recurring_value?: number;
    milestones?: ContractMilestone[];
    start_at?: string;
    end_at?: string;
  }
) => apiPost<AccountContract>(`/accounts/${accountId}/contracts`, body);

export const updateContract = (
  accountId: string,
  contractId: string,
  body: {
    title?: string;
    value?: number;
    status?: ContractStatus;
    billing_type?: BillingType;
    recurring_interval?: RecurringInterval;
    recurring_value?: number;
    milestones?: ContractMilestone[];
    start_at?: string;
    end_at?: string;
  }
) => apiPut<AccountContract>(`/accounts/${accountId}/contracts/${contractId}`, body);

export const deleteContract = (accountId: string, contractId: string) =>
  apiDelete<{ ok: boolean }>(`/accounts/${accountId}/contracts/${contractId}`);
