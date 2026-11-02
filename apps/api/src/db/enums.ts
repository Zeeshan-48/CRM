export const operator_role = {
  SUPERADMIN: "SUPERADMIN",
  OPERATOR: "OPERATOR",
} as const;
export type operator_role = (typeof operator_role)[keyof typeof operator_role];
export const user_status = {
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
  PENDING: "PENDING",
} as const;
export type user_status = (typeof user_status)[keyof typeof user_status];
export const tenant_status = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  CLOSED: "CLOSED",
} as const;
export type tenant_status = (typeof tenant_status)[keyof typeof tenant_status];
export const entitlement_source = {
  PLAN: "PLAN",
  ADMIN: "ADMIN",
} as const;
export type entitlement_source = (typeof entitlement_source)[keyof typeof entitlement_source];
export const lead_status = {
  NEW: "NEW",
  QUALIFIED: "QUALIFIED",
  DISQUALIFIED: "DISQUALIFIED",
  CONVERTED: "CONVERTED",
  ATTEMPTED: "ATTEMPTED",
  CONNECTED: "CONNECTED",
  NURTURE: "NURTURE",
  NOT_INTERESTED: "NOT_INTERESTED",
} as const;
export type lead_status = (typeof lead_status)[keyof typeof lead_status];
export const lead_grade = {
  HOT: "HOT",
  WARM: "WARM",
  COLD: "COLD",
} as const;
export type lead_grade = (typeof lead_grade)[keyof typeof lead_grade];
export const lead_ingest_status = {
  CREATED: "CREATED",
  DEDUPED: "DEDUPED",
  REJECTED: "REJECTED",
  SPAM: "SPAM",
} as const;
export type lead_ingest_status = (typeof lead_ingest_status)[keyof typeof lead_ingest_status];
export const contact_lifecycle = {
  LEAD: "LEAD",
  PROSPECT: "PROSPECT",
  CUSTOMER: "CUSTOMER",
} as const;
export type contact_lifecycle = (typeof contact_lifecycle)[keyof typeof contact_lifecycle];
export const contract_status = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  EXPIRED: "EXPIRED",
} as const;
export type contract_status = (typeof contract_status)[keyof typeof contract_status];
export const deal_status = {
  OPEN: "OPEN",
  WON: "WON",
  LOST: "LOST",
} as const;
export type deal_status = (typeof deal_status)[keyof typeof deal_status];
export const activity_type = {
  CALL: "CALL",
  MEETING: "MEETING",
  DEMO: "DEMO",
  NOTE: "NOTE",
  EMAIL: "EMAIL",
  TASK: "TASK",
} as const;
export type activity_type = (typeof activity_type)[keyof typeof activity_type];
export const message_direction = {
  INBOUND: "INBOUND",
  OUTBOUND: "OUTBOUND",
} as const;
export type message_direction = (typeof message_direction)[keyof typeof message_direction];
export const task_status = {
  OPEN: "OPEN",
  DONE: "DONE",
  CANCELLED: "CANCELLED",
} as const;
export type task_status = (typeof task_status)[keyof typeof task_status];
export const priority = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
} as const;
export type priority = (typeof priority)[keyof typeof priority];
export const channel = {
  WHATSAPP: "WHATSAPP",
  EMAIL: "EMAIL",
  SMS: "SMS",
  TELEGRAM: "TELEGRAM",
  CHAT: "CHAT",
  FACEBOOK: "FACEBOOK",
  INSTAGRAM: "INSTAGRAM",
  VOICE: "VOICE",
} as const;
export type channel = (typeof channel)[keyof typeof channel];
export const conversation_status = {
  OPEN: "OPEN",
  CLOSED: "CLOSED",
} as const;
export type conversation_status = (typeof conversation_status)[keyof typeof conversation_status];
export const wa_template_category = {
  MARKETING: "MARKETING",
  ONBOARDING: "ONBOARDING",
  TRANSACTIONAL: "TRANSACTIONAL",
} as const;
export type wa_template_category = (typeof wa_template_category)[keyof typeof wa_template_category];
export const wa_template_status = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  REJECTED: "REJECTED",
} as const;
export type wa_template_status = (typeof wa_template_status)[keyof typeof wa_template_status];
export const campaign_status = {
  ACTIVE: "ACTIVE",
  PAUSED: "PAUSED",
  COMPLETED: "COMPLETED",
} as const;
export type campaign_status = (typeof campaign_status)[keyof typeof campaign_status];
export const ticket_priority = {
  URGENT: "URGENT",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
} as const;
export type ticket_priority = (typeof ticket_priority)[keyof typeof ticket_priority];
export const ticket_status = {
  OPEN: "OPEN",
  PENDING: "PENDING",
  RESOLVED: "RESOLVED",
  CLOSED: "CLOSED",
} as const;
export type ticket_status = (typeof ticket_status)[keyof typeof ticket_status];
export const kb_status = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
  ARCHIVED: "ARCHIVED",
} as const;
export type kb_status = (typeof kb_status)[keyof typeof kb_status];
export const invoice_status = {
  DRAFT: "DRAFT",
  SENT: "SENT",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  REFUNDED: "REFUNDED",
} as const;
export type invoice_status = (typeof invoice_status)[keyof typeof invoice_status];
export const payment_status = {
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  PENDING: "PENDING",
  REFUNDED: "REFUNDED",
} as const;
export type payment_status = (typeof payment_status)[keyof typeof payment_status];
export const meeting_mode = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
} as const;
export type meeting_mode = (typeof meeting_mode)[keyof typeof meeting_mode];
export const meeting_status = {
  SCHEDULED: "SCHEDULED",
  CANCELLED: "CANCELLED",
  COMPLETED: "COMPLETED",
} as const;
export type meeting_status = (typeof meeting_status)[keyof typeof meeting_status];
export const reminder_status = {
  OPEN: "OPEN",
  DONE: "DONE",
} as const;
export type reminder_status = (typeof reminder_status)[keyof typeof reminder_status];
export const storage_provider = {
  S3: "S3",
  LOCAL: "LOCAL",
} as const;
export type storage_provider = (typeof storage_provider)[keyof typeof storage_provider];
export const email_domain_status = {
  PENDING: "PENDING",
  VERIFIED: "VERIFIED",
  FAILED: "FAILED",
  DISABLED: "DISABLED",
} as const;
export type email_domain_status = (typeof email_domain_status)[keyof typeof email_domain_status];
export const email_identity_status = {
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type email_identity_status =
  (typeof email_identity_status)[keyof typeof email_identity_status];
export const email_category = {
  TRANSACTIONAL: "TRANSACTIONAL",
  NOTIFICATION: "NOTIFICATION",
  MARKETING: "MARKETING",
} as const;
export type email_category = (typeof email_category)[keyof typeof email_category];
export const email_message_status = {
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  BOUNCED: "BOUNCED",
  COMPLAINED: "COMPLAINED",
  REJECTED: "REJECTED",
  FAILED: "FAILED",
  SUPPRESSED: "SUPPRESSED",
} as const;
export type email_message_status = (typeof email_message_status)[keyof typeof email_message_status];
export const email_suppression_reason = {
  HARD_BOUNCE: "HARD_BOUNCE",
  COMPLAINT: "COMPLAINT",
  MANUAL_UNSUBSCRIBE: "MANUAL_UNSUBSCRIBE",
  ADMIN_BLOCK: "ADMIN_BLOCK",
  IMPORTED: "IMPORTED",
} as const;
export type email_suppression_reason =
  (typeof email_suppression_reason)[keyof typeof email_suppression_reason];
export const email_sending_status = {
  ACTIVE: "ACTIVE",
  WARNING: "WARNING",
  THROTTLED: "THROTTLED",
  PAUSED: "PAUSED",
} as const;
export type email_sending_status = (typeof email_sending_status)[keyof typeof email_sending_status];
export const telephony_status = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
} as const;
export type telephony_status = (typeof telephony_status)[keyof typeof telephony_status];
export const subscription_status = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  PAST_DUE: "PAST_DUE",
  CANCELED: "CANCELED",
  EXPIRED: "EXPIRED",
  PAUSED: "PAUSED",
  GRANDFATHERED: "GRANDFATHERED",
} as const;
export type subscription_status = (typeof subscription_status)[keyof typeof subscription_status];
export const billing_interval = {
  MONTHLY: "MONTHLY",
  ANNUAL: "ANNUAL",
} as const;
export type billing_interval = (typeof billing_interval)[keyof typeof billing_interval];
export const billing_mode = {
  AUTO: "AUTO",
  MANUAL: "MANUAL",
} as const;
export type billing_mode = (typeof billing_mode)[keyof typeof billing_mode];
export const platform_txn_status = {
  PENDING: "PENDING",
  PAID: "PAID",
  FAILED: "FAILED",
  REFUNDED: "REFUNDED",
} as const;
export type platform_txn_status = (typeof platform_txn_status)[keyof typeof platform_txn_status];
export const platform_txn_kind = {
  CYCLE: "CYCLE",
  SETUP: "SETUP",
  PRORATION: "PRORATION",
  REFUND: "REFUND",
} as const;
export type platform_txn_kind = (typeof platform_txn_kind)[keyof typeof platform_txn_kind];
