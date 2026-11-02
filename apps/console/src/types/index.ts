// Shared types for the Open CRM Operator console. These mirror the response
// shapes of apps/api (operator plane) (every endpoint wraps payloads in the
// envelope below; the axios client unwraps `.data` before callers see these).

// ---- API envelope ----

export interface ApiSuccessEnvelope<T> {
  data: T;
  statusCode: number;
  message: string;
  success: true;
}

export interface ApiErrorEnvelope {
  error: { message: string };
  statusCode: number;
  message: string;
  success: false;
}

// ---- Operators / auth ----

export type OperatorRole = "SUPERADMIN" | "OPERATOR";
export type OperatorStatus = "ACTIVE" | "DISABLED" | "PENDING";

export interface OperatorUser {
  id: string;
  name: string;
  email: string;
  role: OperatorRole;
  status: OperatorStatus;
  last_login_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface CreateOperatorResponse extends OperatorUser {
  // Whether the invite email carrying the temporary password went out.
  emailed: boolean;
  // Returned only when the password was generated AND email is unconfigured:
  // the sole chance to read it. Absent whenever a password was supplied.
  tempPassword?: string;
}

export interface LoginResponse {
  token: string;
  user: OperatorUser;
}

// ---- Plans ----

export interface PlanLimits {
  seats: number;
  leads: number;
  ai_credits_monthly: number;
}

export interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  modules: string[];
  limits: PlanLimits;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ---- Tenants ----

export type TenantStatus = "ACTIVE" | "SUSPENDED" | "CLOSED";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  domain: string | null;
  industry: string | null;
  plan_key: string | null;
  brand_color: string;
  email_domain: string | null;
  white_label: boolean;
  status: TenantStatus;
  created_at: string;
  updated_at: string;
}

export interface TenantUsage {
  users: number;
  leads: number;
}

export interface TenantWithUsage extends Tenant {
  usage: TenantUsage;
}

export type EntitlementSource = "PLAN" | "ADMIN";

export interface Entitlement {
  id: string;
  tenant_id: string;
  code: string;
  enabled: boolean;
  limit_value: number | null;
  source: EntitlementSource;
  created_at: string;
  updated_at: string;
}

export interface TenantAdminUser {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

export interface TenantDetail {
  tenant: Tenant;
  entitlements: Entitlement[];
  usage: TenantUsage;
  adminUsers: TenantAdminUser[];
}

export interface OnboardTenantPayload {
  name: string;
  slug?: string;
  industry?: string;
  domain?: string;
  brand_color?: string;
  plan_key: string;
  // Optional platform-billing gateway. When set, the tenant is created SUSPENDED
  // with a PENDING subscription (payment upfront); omitted = active immediately.
  gateway?: BillingGateway;
  billingMode?: BillingMode;
  // The admin's first password is auto-generated server-side and emailed to
  // them; the operator never sets or sees it.
  admin: { name: string; email: string };
}

export interface OnboardTenantResponse {
  tenant: Tenant;
  adminUser: TenantAdminUser;
  entitlements: Entitlement[];
  emailDispatched: boolean;
  subscription: Subscription | null;
  checkoutUrl: string | null;
}

// ---- Platform billing (operator charges tenants) ----

export type BillingGateway = "RAZORPAY" | "STRIPE";

export type BillingMode = "AUTO" | "MANUAL";

export type SubscriptionStatus =
  | "PENDING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELED"
  | "EXPIRED"
  | "PAUSED"
  | "GRANDFATHERED";

export interface Subscription {
  id: string;
  tenant_id: string;
  plan_key: string;
  gateway: string;
  billing_interval: string;
  billing_mode: BillingMode;
  status: SubscriptionStatus;
  gateway_customer_id: string | null;
  gateway_subscription_id: string | null;
  checkout_url: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  grace_until: string | null;
  amount: number; // smallest currency unit (paise)
  currency: string;
  created_at: string;
  updated_at: string;
}

export type PlatformTxnStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

export interface PlatformTransaction {
  id: string;
  tenant_id: string;
  subscription_id: string;
  gateway: string;
  gateway_invoice_id: string | null;
  gateway_payment_id: string | null;
  amount: number; // paise
  currency: string;
  status: PlatformTxnStatus;
  kind: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  failure_reason: string | null;
  occurred_at: string;
  created_at: string;
  updated_at: string;
}

export interface TenantSubscriptionResponse {
  subscription: Subscription | null;
}

export interface CreateSubscriptionResponse {
  subscription: Subscription;
  checkoutUrl: string | null;
}

export interface BillingMetrics {
  mrr: number; // paise
  currency: string;
  byStatus: Record<string, number>;
  upcomingRenewals: Array<{
    tenant_id: string;
    plan_key: string;
    amount: number;
    current_period_end: string | null;
  }>;
}

// ---- Metrics ----

export interface MetricsOverview {
  tenants: { total: number; byStatus: Record<string, number> };
  planDistribution: Array<{ plan_key: string; count: number }>;
  totals: { users: number; leads: number };
}

// ---- Audit ----

export interface AuditRow {
  id: string;
  actor_operator_id: string | null;
  actor_email: string | null;
  action: string;
  category: string;
  tenant_id: string | null;
  resource_id: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}
