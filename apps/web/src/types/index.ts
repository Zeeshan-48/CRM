// Shared types for the Open CRM frontend. These mirror the response shapes
// of open-crm-api (every endpoint wraps payloads in the envelope below;
// the axios client unwraps `.data` before these types are seen by callers).

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

// ---- Auth ----

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  brand_color: string;
  plan_key: string | null;
  domain: string | null;
}

export interface PublicTenant {
  slug: string;
  name: string;
  brand_color: string;
  domain: string | null;
}

export type UserRole =
  | "ADMIN"
  | "MANAGER"
  | "SALES_AGENT"
  | "SUPPORT_AGENT"
  | "MARKETING_AGENT"
  | "HR"
  | "FINANCE"
  | (string & {});

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenant_id: string;
  /** Agent callback (mobile) number for click-to-call, E.164. */
  phone?: string | null;
  /** Agent presence: inbound call routing skips unavailable agents. */
  available_for_calls?: boolean;
  /** Module keys this user can access; contains "*" for every module. */
  modules: string[];
  tenant: Tenant;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// ---- Tenant workspace ----

export interface TenantUsage {
  users: number;
  leads: number;
  contacts: number;
  deals: number;
  openDealValue: number;
}

export interface TenantMe {
  tenant: Tenant & Record<string, unknown>;
  usage: TenantUsage;
  modules: string[];
  limits: Record<string, number | null>;
}

// ---- Analytics ----

export interface AnalyticsOverview {
  leads: number;
  contacts: number;
  openDeals: number;
  revenue: number;
  weightedPipeline: number;
  openTickets: number;
  conversations: number;
}

// ---- AI agents ----

export interface AgentSummary {
  key: string;
  name: string;
  description: string;
  runCount: number;
  lastRunAt: string | null;
}

// ---- Notifications ----

export interface NotificationItem {
  id: string;
  tenant_id: string;
  user_id: string;
  text: string;
  link: string | null;
  read: boolean;
  created_at: string;
}

export interface NotificationsResponse {
  unread: number;
  notifications: NotificationItem[];
}

// ---- Reminders ----

export interface ReminderCount {
  open: number;
  dueToday: number;
}

// ---- Copilot ----

export interface CopilotAnswer {
  question: string;
  intent: string;
  answer: string;
  columns: string[];
  rows: (string | number)[][];
}

// ---- Global search ----

export interface SearchResultItem {
  id: string;
  title: string;
  sub: string;
  /** Route segment without the leading slash, e.g. "leads" or "pipeline". */
  route: string;
}

export interface SearchGroup {
  type: string;
  items: SearchResultItem[];
}

// ---- Billing (this workspace's subscription with the platform operator) ----

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
  amount: number; // paise
  currency: string;
  status: PlatformTxnStatus;
  kind: string;
  gateway: string;
  hosted_invoice_url: string | null;
  occurred_at: string;
}

export interface BillingPlan {
  key: string;
  name: string;
  description: string | null;
  price_monthly: number;
  currency: string;
  modules: unknown;
  limits: unknown;
}

export interface MyBilling {
  subscription: Subscription | null;
  plan: BillingPlan | null;
}
