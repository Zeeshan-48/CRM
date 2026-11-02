// CRM module keys: the unit of both RBAC (role -> modules) and tenant
// entitlements (plan -> modules). Keep in sync with the operator backend's
// plan editor and the frontend navigation registry.

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

export const isModuleKey = (value: string): value is ModuleKey =>
  (MODULES as readonly string[]).includes(value);

// Governance capabilities: administration / provider-setup surfaces that EVERY
// workspace has regardless of the plan it bought. Unlike feature MODULES above,
// these are RBAC-only, access is decided purely by the user's role, with no
// tenant entitlement required (see requireCapability + resolveVisibleModules).
// This is what lets a role grant/deny channel setup, billing, user management,
// and workspace settings without any operator-backend/plan coordination.
export const GOVERNANCE_CAPABILITIES = [
  "channels", // BYO provider/channel configuration (email sending, WhatsApp, telephony)
  "team", // user + role management
  "billing", // subscription, invoices, payment methods
  "settings", // workspace + tenant configuration
] as const;

export type GovernanceCapability = (typeof GOVERNANCE_CAPABILITIES)[number];

export const isGovernanceCapability = (value: string): value is GovernanceCapability =>
  (GOVERNANCE_CAPABILITIES as readonly string[]).includes(value);

// Every access key a role may hold: entitlement-gated feature modules plus the
// RBAC-only governance capabilities. Used to validate role definitions and to
// build the role-editor catalogue.
export const ALL_CAPABILITIES: string[] = [...MODULES, ...GOVERNANCE_CAPABILITIES];

export const isCapabilityKey = (value: string): boolean =>
  isModuleKey(value) || isGovernanceCapability(value);

export const BUILTIN_ROLE_KEYS = [
  "ADMIN",
  "MANAGER",
  "SALES_AGENT",
  "SUPPORT_AGENT",
  "MARKETING_AGENT",
  "HR",
  "FINANCE",
] as const;

export type BuiltinRoleKey = (typeof BUILTIN_ROLE_KEYS)[number];

// Module access per built-in role. "*" means every module.
export const ROLE_MODULES: Record<BuiltinRoleKey, string[]> = {
  ADMIN: ["*"],
  MANAGER: [
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
    "integrations",
    "audit",
    // Governance capabilities (RBAC-only): managers run channels + user/role
    // management. Billing and workspace Settings stay ADMIN-only.
    "channels",
    "team",
    "products",
  ],
  SALES_AGENT: [
    "leads",
    "contacts",
    "accounts",
    "deals",
    "activities",
    "inbox",
    "whatsapp",
    "voice",
    "calendar",
    "copilot",
    "agents",
    "kb",
    // Agents read the catalog and a lead's product activity. Wiring the
    // integration up stays behind `integrations` + `settings`.
    "products",
  ],
  SUPPORT_AGENT: ["tickets", "kb", "inbox", "contacts", "whatsapp", "calendar", "copilot"],
  MARKETING_AGENT: [
    "campaigns",
    "email",
    "whatsapp",
    "leads",
    "analytics",
    "copilot",
    "agents",
    "products",
  ],
  HR: ["kb", "calendar", "copilot"],
  FINANCE: ["finance", "analytics", "accounts", "copilot"],
};

export const isBuiltinRole = (role: string): role is BuiltinRoleKey =>
  (BUILTIN_ROLE_KEYS as readonly string[]).includes(role);

// Elevated roles. Even with the `team` capability, only an ADMIN may invite,
// modify, reassign, or delete a user in one of these roles, or edit the role's
// module set. Managers can manage every OTHER role and user.
export const ELEVATED_ROLES = ["ADMIN", "MANAGER"] as const;

export const isElevatedRole = (role: string): boolean =>
  (ELEVATED_ROLES as readonly string[]).includes(role);

// Entitlement codes. Module gates are `module.<key>`; limits are explicit.
export const moduleEntitlementCode = (moduleKey: string): string => `module.${moduleKey}`;

export const LIMIT_CODES = {
  SEATS: "limit.seats",
  LEADS: "limit.leads",
  AI_CREDITS_MONTHLY: "limit.ai_credits_monthly",
  // How many external products a workspace may wire up. Paired with
  // `module.products` as the master gate, two entitlements for the whole
  // product-integration platform, per the workspace convention.
  CONNECTED_APPS: "limit.connected_apps",
} as const;

// Human-facing metadata for every access key, the single source of truth for
// the role editor's picker (label, one-line description, grouping) and for
// module labels in the UI. `governance: true` marks the RBAC-only capabilities.
export interface ModuleMeta {
  key: string;
  label: string;
  description: string;
  group: string;
  governance: boolean;
}

export const MODULE_CATALOGUE: ModuleMeta[] = [
  // Sales
  { key: "leads", label: "Leads", description: "Capture and work inbound/outbound leads.", group: "Sales", governance: false },
  { key: "contacts", label: "Contacts", description: "People records and their history.", group: "Sales", governance: false },
  { key: "accounts", label: "Accounts", description: "Company records and hierarchy.", group: "Sales", governance: false },
  { key: "deals", label: "Pipeline", description: "Opportunities and the sales pipeline.", group: "Sales", governance: false },
  { key: "activities", label: "Activities", description: "Tasks, calls and logged touchpoints.", group: "Sales", governance: false },
  { key: "calendar", label: "Calendar", description: "Meetings and scheduling.", group: "Sales", governance: false },
  // Conversations
  { key: "inbox", label: "Inbox", description: "Unified two-way conversation inbox.", group: "Conversations", governance: false },
  { key: "whatsapp", label: "WhatsApp", description: "Send and receive WhatsApp messages.", group: "Conversations", governance: false },
  { key: "voice", label: "Telephony", description: "Click-to-call, inbound routing, recordings and call summaries.", group: "Conversations", governance: false },
  { key: "email", label: "Email", description: "Compose and send tracked email.", group: "Conversations", governance: false },
  // Marketing
  { key: "campaigns", label: "Campaigns", description: "Bulk outreach to a tagged audience.", group: "Marketing", governance: false },
  // Service
  { key: "tickets", label: "Tickets", description: "Support ticket queue.", group: "Service", governance: false },
  { key: "kb", label: "Knowledge Base", description: "Internal/product knowledge articles.", group: "Service", governance: false },
  // Automation
  { key: "workflows", label: "Workflows", description: "No-code automation rules.", group: "Automation", governance: false },
  { key: "agents", label: "AI Agents", description: "AI sales/support agents and the Sales Agent.", group: "Automation", governance: false },
  { key: "copilot", label: "Copilot", description: "The in-app AI copilot assistant.", group: "Automation", governance: false },
  // Insights
  { key: "analytics", label: "Analytics", description: "Dashboards and reporting.", group: "Insights", governance: false },
  { key: "finance", label: "Finance", description: "Payments, invoices and revenue.", group: "Insights", governance: false },
  // Products, the product-integration platform: the catalog an agent pitches
  // from, what a lead did inside the connected product, and the signals feed.
  { key: "products", label: "Products", description: "Connected product catalog, pricing, offers and buyer intent signals.", group: "Sales", governance: false },
  // Administration, feature modules (entitlement-gated)
  { key: "integrations", label: "Integrations & API", description: "Connected services, webhooks and API keys.", group: "Administration", governance: false },
  { key: "audit", label: "Audit & Compliance", description: "Audit log and compliance settings.", group: "Administration", governance: false },
  // Administration, governance capabilities (RBAC-only, every workspace has them)
  { key: "channels", label: "Channel Setup", description: "Configure BYO providers: email sending, WhatsApp, telephony.", group: "Administration", governance: true },
  { key: "team", label: "Users & Roles", description: "Invite users, assign roles, and manage roles.", group: "Administration", governance: true },
  { key: "billing", label: "Billing", description: "Subscription, invoices and payment methods.", group: "Administration", governance: true },
  { key: "settings", label: "Workspace Settings", description: "Workspace configuration and tenant settings.", group: "Administration", governance: true },
];

export const moduleLabel = (key: string): string =>
  key === "*" ? "All modules" : (MODULE_CATALOGUE.find((m) => m.key === key)?.label ?? key);
