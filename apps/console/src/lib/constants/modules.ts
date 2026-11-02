// CRM module keys: the unit of tenant entitlements (plan -> modules).
// MIRRORED from apps/api/src/constants/modules.const.ts;
// keep the two lists in sync whenever a CRM module is added or removed.

export const MODULES = [
  "leads",
  "contacts",
  "accounts",
  "deals",
  "activities",
  "inbox",
  "whatsapp",
  "voice",
  "email",
  "campaigns",
  "tickets",
  "kb",
  "calendar",
  "workflows",
  "copilot",
  "agents",
  "analytics",
  "finance",
  "products",
  "integrations",
  "audit",
] as const;

export type ModuleKey = (typeof MODULES)[number];

export const MODULE_LABELS: Record<ModuleKey, string> = {
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
  activities: "Activities",
  inbox: "Inbox",
  whatsapp: "WhatsApp",
  voice: "Telephony",
  email: "Email",
  campaigns: "Campaigns",
  tickets: "Tickets",
  kb: "Knowledge Base",
  calendar: "Calendar",
  workflows: "Workflows",
  copilot: "Copilot",
  agents: "AI Agents",
  analytics: "Analytics",
  finance: "Finance",
  products: "Products & Integrations",
  integrations: "Integrations",
  audit: "Audit",
};

export const moduleLabel = (key: string): string =>
  MODULE_LABELS[key as ModuleKey] ?? key;

// Entitlement codes. Module gates are `module.<key>`; limits are explicit.
export const MODULE_CODE_PREFIX = "module.";
export const LIMIT_CODE_PREFIX = "limit.";

export const LIMIT_LABELS: Record<string, string> = {
  "limit.seats": "Seats",
  "limit.leads": "Leads",
  "limit.ai_credits_monthly": "AI credits / month",
  "limit.connected_apps": "Connected products",
};

export const limitLabel = (code: string): string =>
  LIMIT_LABELS[code] ?? code.replace(LIMIT_CODE_PREFIX, "");
