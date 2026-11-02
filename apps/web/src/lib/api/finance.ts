import { apiDelete, apiGet, apiPost, apiPut } from "./client";

// ---- Types (mirror open-crm-api finance.service.ts) ----

export interface PaymentGateway {
  id: string;
  name: string;
  live: boolean;
}

export interface FinanceSummary {
  revenue: number;
  invoiced: number;
  paid: number;
  pending: number;
  tax: number;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "REFUNDED";

export interface Invoice {
  id: string;
  tenant_id: string;
  number: string;
  deal_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  /** Account name (left-joined; null when unlinked). */
  account: string | null;
  /** Contact name (left-joined; null when unlinked). */
  contact: string | null;
  amount: number;
  tax: number;
  total: number;
  status: InvoiceStatus;
  gateway: string | null;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export type PaymentStatus = "SUCCESS" | "FAILED" | "PENDING" | "REFUNDED";

export interface Payment {
  id: string;
  tenant_id: string;
  invoice_id: string;
  amount: number;
  status: PaymentStatus;
  gateway: string | null;
  reference: string | null;
  pay_url?: string | null;
  gateway_payment_id?: string | null;
  at: string;
  created_at: string;
}

// ---- BYO Razorpay connection ----
export type RazorpayStatus = "PENDING" | "ACTIVE" | "DISABLED";

export interface RazorpayConfig {
  configured: boolean;
  status: RazorpayStatus;
  key_id: string | null;
  key_secret_set: boolean;
  /** Optional masked hint (for example the last 4 characters) of the stored secret. */
  key_secret_hint?: string | null;
  verified_at: string | null;
  last_error: string | null;
  defaultAvailable: boolean;
  simulated: boolean;
}

/** Secrets are write-only. On update, a blank field keeps the stored value. */
export interface SaveRazorpayInput {
  keyId: string;
  keySecret: string;
}

export interface PaymentLinkResult {
  payment: Payment;
  pay_url: string;
  simulated: boolean;
}

export interface CreateInvoiceInput {
  amount: number;
  tax?: number;
  accountId?: string;
  contactId?: string;
  dueAt?: string;
}

export interface UpdateInvoiceInput {
  amount?: number;
  tax?: number;
  accountId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  dueAt?: string | null;
  gateway?: string;
}

export interface InvoiceActionResult {
  invoice: Omit<Invoice, "account" | "total">;
  payment: Payment;
}

/** Lightweight account row for the invoice dialog select. */
export interface AccountOption {
  id: string;
  name: string;
}

// ---- Calls ----

export const listGateways = () => apiGet<PaymentGateway[]>("/finance/gateways");

export const getFinanceSummary = () => apiGet<FinanceSummary>("/finance/summary");

export const listInvoices = () => apiGet<Invoice[]>("/finance/invoices");

export const listPayments = () => apiGet<Payment[]>("/finance/payments");

export const createInvoice = (input: CreateInvoiceInput) =>
  apiPost<Invoice>("/finance/invoices", input);

export const updateInvoice = (id: string, input: UpdateInvoiceInput) =>
  apiPut<Invoice>(`/finance/invoices/${id}`, input);

export const deleteInvoice = (id: string) =>
  apiDelete<{ ok: boolean }>(`/finance/invoices/${id}`);

export const payInvoice = (id: string) =>
  apiPost<InvoiceActionResult>(`/finance/invoices/${id}/pay`);

export const refundInvoice = (id: string, manual = false) =>
  apiPost<InvoiceActionResult>(`/finance/invoices/${id}/refund`, manual ? { manual: true } : {});

export const createPaymentLink = (id: string) =>
  apiPost<PaymentLinkResult>(`/finance/invoices/${id}/payment-link`);

export const listAccountOptions = () => apiGet<AccountOption[]>("/accounts");

// ---- Razorpay connection ----
export const getRazorpayConfig = () => apiGet<RazorpayConfig>("/finance/razorpay/config");
export const saveRazorpayConfig = (input: SaveRazorpayInput) =>
  apiPut<RazorpayConfig>("/finance/razorpay/config", input);
export const validateRazorpayConfig = () =>
  apiPost<RazorpayConfig>("/finance/razorpay/config/validate");
export const removeRazorpayConfig = () =>
  apiDelete<{ ok: boolean }>("/finance/razorpay/config");

// ---- Stripe connection ----
export interface StripeConfig {
  configured: boolean;
  status: RazorpayStatus;
  secret_key_hint: string | null;
  secret_key_set: boolean;
  verified_at: string | null;
  last_error: string | null;
  defaultAvailable: boolean;
  simulated: boolean;
}

export const getStripeConfig = () => apiGet<StripeConfig>("/finance/stripe/config");
/** Blank secretKey on update keeps the stored key (the API never returns it). */
export const saveStripeConfig = (secretKey: string) =>
  apiPut<StripeConfig>("/finance/stripe/config", { secretKey });
export const validateStripeConfig = () =>
  apiPost<StripeConfig>("/finance/stripe/config/validate");
export const removeStripeConfig = () => apiDelete<{ ok: boolean }>("/finance/stripe/config");

// ---- Default gateway ----
export type GatewayName = "Razorpay" | "Stripe";
export const getGatewayDefault = () =>
  apiGet<{ gateway: GatewayName }>("/finance/gateway-default");
export const setGatewayDefault = (gateway: GatewayName) =>
  apiPut<{ gateway: GatewayName }>("/finance/gateway-default", { gateway });
