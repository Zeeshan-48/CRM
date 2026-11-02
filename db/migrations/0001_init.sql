-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "operator_role" AS ENUM ('SUPERADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED', 'PENDING');

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "entitlement_source" AS ENUM ('PLAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "lead_status" AS ENUM ('NEW', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED', 'ATTEMPTED', 'CONNECTED', 'NURTURE', 'NOT_INTERESTED');

-- CreateEnum
CREATE TYPE "lead_grade" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "lead_ingest_status" AS ENUM ('CREATED', 'DEDUPED', 'REJECTED', 'SPAM');

-- CreateEnum
CREATE TYPE "contact_lifecycle" AS ENUM ('LEAD', 'PROSPECT', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "contract_status" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "deal_status" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "activity_type" AS ENUM ('CALL', 'MEETING', 'DEMO', 'NOTE', 'EMAIL', 'TASK');

-- CreateEnum
CREATE TYPE "message_direction" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "task_status" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "priority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "channel" AS ENUM ('WHATSAPP', 'EMAIL', 'SMS', 'TELEGRAM', 'CHAT', 'FACEBOOK', 'INSTAGRAM', 'VOICE');

-- CreateEnum
CREATE TYPE "conversation_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "wa_template_category" AS ENUM ('MARKETING', 'ONBOARDING', 'TRANSACTIONAL');

-- CreateEnum
CREATE TYPE "wa_template_status" AS ENUM ('APPROVED', 'PENDING', 'REJECTED');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'PENDING', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "kb_status" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "invoice_status" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('SUCCESS', 'FAILED', 'PENDING', 'REFUNDED');

-- CreateEnum
CREATE TYPE "meeting_mode" AS ENUM ('ONLINE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "meeting_status" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "reminder_status" AS ENUM ('OPEN', 'DONE');

-- CreateEnum
CREATE TYPE "storage_provider" AS ENUM ('S3', 'LOCAL');

-- CreateEnum
CREATE TYPE "email_domain_status" AS ENUM ('PENDING', 'VERIFIED', 'FAILED', 'DISABLED');

-- CreateEnum
CREATE TYPE "email_identity_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "email_category" AS ENUM ('TRANSACTIONAL', 'NOTIFICATION', 'MARKETING');

-- CreateEnum
CREATE TYPE "email_message_status" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'REJECTED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "email_suppression_reason" AS ENUM ('HARD_BOUNCE', 'COMPLAINT', 'MANUAL_UNSUBSCRIBE', 'ADMIN_BLOCK', 'IMPORTED');

-- CreateEnum
CREATE TYPE "email_sending_status" AS ENUM ('ACTIVE', 'WARNING', 'THROTTLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "telephony_status" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'PAUSED', 'GRANDFATHERED');

-- CreateEnum
CREATE TYPE "billing_interval" AS ENUM ('MONTHLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "billing_mode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "platform_txn_status" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "platform_txn_kind" AS ENUM ('CYCLE', 'SETUP', 'PRORATION', 'REFUND');

-- CreateTable
CREATE TABLE "operator_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "operator_role" NOT NULL DEFAULT 'OPERATOR',
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_monthly" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "modules" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "plan_key" TEXT,
    "brand_color" TEXT NOT NULL DEFAULT '#b6207f',
    "email_domain" TEXT,
    "white_label" BOOLEAN NOT NULL DEFAULT false,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "email_sending_status" "email_sending_status" NOT NULL DEFAULT 'ACTIVE',
    "email_sending_status_changed_at" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_entitlements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "limit_value" INTEGER,
    "source" "entitlement_source" NOT NULL DEFAULT 'PLAN',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operator_audit_logs" (
    "id" TEXT NOT NULL,
    "actor_operator_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tenant_id" TEXT,
    "resource_id" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operator_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "permissions" JSONB,
    "territory" JSONB,
    "skills" JSONB,
    "avatar_color" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "phone" TEXT,
    "available_for_calls" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "source" TEXT,
    "campaign" TEXT,
    "status" "lead_status" NOT NULL DEFAULT 'NEW',
    "owner_id" TEXT,
    "tags" JSONB,
    "socials" JSONB,
    "notes" TEXT,
    "budget" BOOLEAN NOT NULL DEFAULT false,
    "score_total" INTEGER NOT NULL DEFAULT 0,
    "score_grade" "lead_grade" NOT NULL DEFAULT 'COLD',
    "score_breakdown" JSONB,
    "scored_at" TIMESTAMP(3),
    "converted_contact_id" TEXT,
    "converted_deal_id" TEXT,
    "external_id" TEXT,
    "external_source" TEXT,
    "custom_fields" JSONB,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_documents" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "doc_type" TEXT,
    "file_key" TEXT,
    "url" TEXT,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "account_id" TEXT,
    "title" TEXT,
    "city" TEXT,
    "owner_id" TEXT,
    "tags" JSONB,
    "socials" JSONB,
    "lifecycle" "contact_lifecycle" NOT NULL DEFAULT 'LEAD',
    "converted_from_lead_id" TEXT,
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "size" TEXT,
    "website" TEXT,
    "owner_id" TEXT,
    "departments" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_contracts" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "title" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "status" "contract_status" NOT NULL DEFAULT 'ACTIVE',
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "won" BOOLEAN NOT NULL DEFAULT false,
    "lost" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "owner_id" TEXT,
    "lead_id" TEXT,
    "account_id" TEXT,
    "contact_id" TEXT,
    "status" "deal_status" NOT NULL DEFAULT 'OPEN',
    "expected_close_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "competitors" JSONB,
    "stakeholders" JSONB,
    "lost_reason" TEXT,
    "win_probability" INTEGER NOT NULL DEFAULT 0,
    "health_score" INTEGER NOT NULL DEFAULT 0,
    "health_label" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "type" "activity_type" NOT NULL,
    "direction" "message_direction",
    "subject" TEXT,
    "notes" TEXT,
    "owner_id" TEXT,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "deal_id" TEXT,
    "duration_sec" INTEGER,
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "task_status" NOT NULL DEFAULT 'OPEN',
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "due_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "owner_id" TEXT,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "deal_id" TEXT,
    "remind_daily" BOOLEAN NOT NULL DEFAULT false,
    "reminder_last_sent_at" TIMESTAMP(3),
    "ai_generated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "subject" TEXT,
    "status" "conversation_status" NOT NULL DEFAULT 'OPEN',
    "unread_count" INTEGER NOT NULL DEFAULT 0,
    "last_message_at" TIMESTAMP(3),
    "last_preview" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "channel" "channel" NOT NULL,
    "direction" "message_direction" NOT NULL,
    "body" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "sender_user_id" TEXT,
    "sentiment" TEXT,
    "sentiment_score" INTEGER,
    "simulated" BOOLEAN NOT NULL DEFAULT true,
    "external_id" TEXT,
    "status" TEXT,
    "campaign_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "wa_template_category" NOT NULL DEFAULT 'MARKETING',
    "status" "wa_template_status" NOT NULL DEFAULT 'APPROVED',
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "variables" INTEGER NOT NULL DEFAULT 0,
    "meta_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "leads_generated" INTEGER NOT NULL DEFAULT 0,
    "status" "campaign_status" NOT NULL DEFAULT 'ACTIVE',
    "audience_tag" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "template_params" JSONB,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT,
    "priority" "ticket_priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ticket_status" NOT NULL DEFAULT 'OPEN',
    "contact_id" TEXT,
    "assignee_id" TEXT,
    "channel" TEXT,
    "lead_id" TEXT,
    "sla_due_at" TIMESTAMP(3),
    "first_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "sentiment" TEXT,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "csat" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_replies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "author_user_id" TEXT,
    "is_ai" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "channel" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "first_response_hours" INTEGER NOT NULL,
    "resolution_hours" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" JSONB,
    "status" "kb_status" NOT NULL DEFAULT 'PUBLISHED',
    "views" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "workflow_name" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "log" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_calls" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "agent_user_id" TEXT,
    "direction" "message_direction" NOT NULL DEFAULT 'OUTBOUND',
    "goal" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'simulated',
    "duration_sec" INTEGER NOT NULL DEFAULT 0,
    "transcript" JSONB,
    "summary" TEXT,
    "sentiment_label" TEXT,
    "sentiment_score" INTEGER,
    "outcome" TEXT,
    "lead_score_delta" INTEGER NOT NULL DEFAULT 0,
    "action_items" JSONB,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "call_error" TEXT,
    "call_status" TEXT,
    "from_number" TEXT,
    "recording_url" TEXT,
    "to_number" TEXT,
    "twilio_call_sid" TEXT,
    "cost_cents" INTEGER,
    "external_call_id" TEXT,
    "structured_data" JSONB,
    "engine_session_id" TEXT,
    "agenda_id" TEXT,
    "brief_context" TEXT,

    CONSTRAINT "voice_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "triggered_by" TEXT,
    "summary" TEXT,
    "actions" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_outreach" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "run_id" TEXT,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "channel" "channel" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "reason" TEXT,
    "message_id" TEXT,
    "created_by" TEXT,
    "reviewed_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "replied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_outreach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_settings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "score_threshold" INTEGER NOT NULL DEFAULT 65,
    "channels" JSONB,
    "tone" TEXT,
    "cadence" JSONB,
    "working_hours" JSONB,
    "daily_cap" INTEGER NOT NULL DEFAULT 20,
    "auto_send" BOOLEAN NOT NULL DEFAULT false,
    "escalate_to_call" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_enrollments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "current_step" INTEGER NOT NULL DEFAULT 0,
    "next_run_at" TIMESTAMP(3),
    "last_touch_at" TIMESTAMP(3),
    "enrolled_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "deal_id" TEXT,
    "account_id" TEXT,
    "contact_id" TEXT,
    "amount" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "status" "invoice_status" NOT NULL DEFAULT 'DRAFT',
    "gateway" TEXT,
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'SUCCESS',
    "gateway" TEXT,
    "reference" TEXT,
    "pay_url" TEXT,
    "gateway_payment_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "owner_id" TEXT,
    "start_at" TIMESTAMP(3) NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "mode" "meeting_mode" NOT NULL DEFAULT 'ONLINE',
    "location" TEXT,
    "status" "meeting_status" NOT NULL DEFAULT 'SCHEDULED',
    "reminder_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "booking_link_id" TEXT,
    "external_provider" TEXT,
    "external_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_connections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'GOOGLE',
    "account_email" TEXT,
    "access_token_encrypted" TEXT,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "scope" TEXT,
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_links" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "duration_min" INTEGER NOT NULL DEFAULT 30,
    "owner_id" TEXT,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "connected_at" TIMESTAMP(3),
    "credentials" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deliveries" INTEGER NOT NULL DEFAULT 0,
    "secret" TEXT NOT NULL,
    "last_delivery_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "created_by" TEXT,
    "app_id" TEXT,
    "scope" TEXT NOT NULL DEFAULT 'SECRET',
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_ingest_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "source" TEXT NOT NULL,
    "external_id" TEXT,
    "status" "lead_ingest_status" NOT NULL,
    "lead_id" TEXT,
    "error" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_ingest_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "api_key_id" TEXT,
    "lead_id" TEXT,
    "event" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT,
    "payload" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "app_id" TEXT,
    "product_id" TEXT,
    "contact_id" TEXT,
    "anonymous_id" TEXT,
    "session_id" TEXT,
    "page_url" TEXT,
    "referrer" TEXT,
    "value_minor" INTEGER,
    "currency" TEXT,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_views" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "priority" "priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "reminder_status" NOT NULL DEFAULT 'OPEN',
    "due_date" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content_type" TEXT,
    "size_bytes" INTEGER,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "uploaded_by" TEXT,
    "storage" "storage_provider" NOT NULL DEFAULT 'LOCAL',
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sending_domains" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "mail_from_subdomain" TEXT,
    "ses_configuration_set" TEXT,
    "status" "email_domain_status" NOT NULL DEFAULT 'PENDING',
    "dkim_status" TEXT,
    "mail_from_status" TEXT,
    "dns_records" JSONB,
    "verified_at" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sending_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_sender_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sending_domain_id" TEXT NOT NULL,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "reply_to" TEXT,
    "status" "email_identity_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default_transactional" BOOLEAN NOT NULL DEFAULT false,
    "is_default_notification" BOOLEAN NOT NULL DEFAULT false,
    "is_default_marketing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_sender_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "category" "email_category" NOT NULL DEFAULT 'NOTIFICATION',
    "sending_domain_id" TEXT,
    "sender_identity_id" TEXT,
    "from_address" TEXT NOT NULL,
    "to_address" TEXT NOT NULL,
    "subject" TEXT,
    "ses_message_id" TEXT,
    "status" "email_message_status" NOT NULL DEFAULT 'QUEUED',
    "idempotency_key" TEXT,
    "delivered_at" TIMESTAMP(3),
    "bounced_at" TIMESTAMP(3),
    "complained_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "clicked_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" "email_suppression_reason" NOT NULL,
    "category_scope" "email_category",
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_reputation_events" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "from_status" "email_sending_status" NOT NULL,
    "to_status" "email_sending_status" NOT NULL,
    "trigger" TEXT NOT NULL,
    "reason" TEXT,
    "rates_snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_reputation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_domain_health_checks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "sending_domain_id" TEXT NOT NULL,
    "dkim_status" TEXT,
    "mail_from_status" TEXT,
    "spf_present" BOOLEAN NOT NULL DEFAULT false,
    "dmarc_present" BOOLEAN NOT NULL DEFAULT false,
    "failures" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_domain_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_telephony" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'TWILIO',
    "account_sid" TEXT,
    "auth_token_encrypted" TEXT,
    "api_key_encrypted" TEXT,
    "subdomain" TEXT,
    "from_number" TEXT,
    "webhook_token" TEXT,
    "status" "telephony_status" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_telephony_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telephony_numbers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "label" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'MAIN',
    "assigned_user_id" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telephony_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_razorpay" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "key_id" TEXT,
    "key_secret_encrypted" TEXT,
    "status" "telephony_status" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_razorpay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_stripe" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'STRIPE',
    "secret_key_encrypted" TEXT,
    "status" "telephony_status" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_stripe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_whatsapp" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'META',
    "phone_number_id" TEXT,
    "waba_id" TEXT,
    "access_token_encrypted" TEXT,
    "app_secret_encrypted" TEXT,
    "webhook_verify_token" TEXT,
    "display_phone_number" TEXT,
    "verified_name" TEXT,
    "business_id" TEXT,
    "registration_pin_encrypted" TEXT,
    "connect_method" TEXT NOT NULL DEFAULT 'EMBEDDED',
    "status" "telephony_status" NOT NULL DEFAULT 'PENDING',
    "verified_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_subscriptions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "billing_interval" "billing_interval" NOT NULL DEFAULT 'MONTHLY',
    "billing_mode" "billing_mode" NOT NULL DEFAULT 'AUTO',
    "status" "subscription_status" NOT NULL DEFAULT 'PENDING',
    "gateway_customer_id" TEXT,
    "gateway_subscription_id" TEXT,
    "checkout_url" TEXT,
    "checkout_ref" TEXT,
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "grace_until" TIMESTAMP(3),
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_transactions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_invoice_id" TEXT,
    "gateway_payment_id" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "platform_txn_status" NOT NULL DEFAULT 'PENDING',
    "kind" "platform_txn_kind" NOT NULL DEFAULT 'CYCLE',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "hosted_invoice_url" TEXT,
    "failure_reason" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_gateway_refs" (
    "id" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "billing_interval" "billing_interval" NOT NULL DEFAULT 'MONTHLY',
    "external_plan_id" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_gateway_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_webhook_events" (
    "id" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "error" TEXT,
    "processed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connected_apps" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "product_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "environment" TEXT NOT NULL DEFAULT 'LIVE',
    "capabilities" JSONB,
    "catalog_mode" TEXT NOT NULL DEFAULT 'PUSH',
    "catalog_pull_url" TEXT,
    "last_catalog_sync_at" TIMESTAMP(3),
    "actions_url" TEXT,
    "actions_secret" TEXT,
    "actions_catalog" JSONB,
    "allowed_origins" JSONB,
    "last_event_at" TIMESTAMP(3),
    "health" TEXT NOT NULL DEFAULT 'PENDING',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connected_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT,
    "external_id" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "family" TEXT,
    "url" TEXT,
    "media" JSONB,
    "attributes" JSONB,
    "highlights" JSONB,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT NOT NULL DEFAULT 'SYNCED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "total_sales" INTEGER NOT NULL DEFAULT 0,
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "price_book" TEXT NOT NULL DEFAULT 'STANDARD',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "amount_minor" INTEGER NOT NULL,
    "compare_at_minor" INTEGER,
    "billing_period" TEXT NOT NULL DEFAULT 'ONE_TIME',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_offers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT,
    "product_id" TEXT,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "currency" TEXT,
    "applies_to" JSONB,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "max_redemptions" INTEGER,
    "redemptions_used" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_event_definitions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'ACTION',
    "icon" TEXT,
    "intent_weight" INTEGER NOT NULL DEFAULT 0,
    "is_high_intent" BOOLEAN NOT NULL DEFAULT false,
    "property_schema" JSONB,
    "review_status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "auto_registered" BOOLEAN NOT NULL DEFAULT false,
    "event_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_event_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_identities" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "identity_type" TEXT NOT NULL,
    "identity_value" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "contact_id" TEXT,
    "lifecycle_stage" TEXT NOT NULL DEFAULT 'VISITOR',
    "plan_name" TEXT,
    "plan_status" TEXT,
    "mrr_minor" INTEGER,
    "currency" TEXT,
    "first_seen_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "signup_at" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "sessions_30d" INTEGER NOT NULL DEFAULT 0,
    "events_30d" INTEGER NOT NULL DEFAULT 0,
    "page_views_30d" INTEGER NOT NULL DEFAULT 0,
    "active_days_30d" INTEGER NOT NULL DEFAULT 0,
    "intent_score" INTEGER NOT NULL DEFAULT 0,
    "intent_band" TEXT NOT NULL DEFAULT 'COLD',
    "intent_reasons" JSONB,
    "checkout_abandoned_at" TIMESTAMP(3),
    "abandoned_cart" JSONB,
    "top_products" JSONB,
    "usage" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engagement_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_line_items" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "product_id" TEXT,
    "offer_id" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "response_code" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "next_retry_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "operator_users_email_key" ON "operator_users"("email");

-- CreateIndex
CREATE INDEX "operator_users_status_idx" ON "operator_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plans_key_key" ON "plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "tenant_entitlements_tenant_id_idx" ON "tenant_entitlements"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_entitlements_tenant_id_code_key" ON "tenant_entitlements"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "operator_audit_logs_created_at_idx" ON "operator_audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "operator_audit_logs_tenant_id_idx" ON "operator_audit_logs"("tenant_id");

-- CreateIndex
CREATE INDEX "operator_audit_logs_action_idx" ON "operator_audit_logs"("action");

-- CreateIndex
CREATE INDEX "users_tenant_id_role_idx" ON "users"("tenant_id", "role");

-- CreateIndex
CREATE INDEX "users_tenant_id_status_idx" ON "users"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "leads_tenant_id_status_idx" ON "leads"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "leads_tenant_id_owner_id_idx" ON "leads"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "leads_tenant_id_source_idx" ON "leads"("tenant_id", "source");

-- CreateIndex
CREATE INDEX "leads_tenant_id_score_grade_idx" ON "leads"("tenant_id", "score_grade");

-- CreateIndex
CREATE INDEX "leads_tenant_id_created_at_idx" ON "leads"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_documents_tenant_id_lead_id_idx" ON "lead_documents"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_lifecycle_idx" ON "contacts"("tenant_id", "lifecycle");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_account_id_idx" ON "contacts"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_owner_id_idx" ON "contacts"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "accounts_tenant_id_idx" ON "accounts"("tenant_id");

-- CreateIndex
CREATE INDEX "account_contracts_tenant_id_account_id_idx" ON "account_contracts"("tenant_id", "account_id");

-- CreateIndex
CREATE INDEX "account_contracts_tenant_id_deal_id_idx" ON "account_contracts"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "pipelines_tenant_id_idx" ON "pipelines"("tenant_id");

-- CreateIndex
CREATE INDEX "stages_tenant_id_pipeline_id_idx" ON "stages"("tenant_id", "pipeline_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_pipeline_id_stage_id_idx" ON "deals"("tenant_id", "pipeline_id", "stage_id");

-- CreateIndex
CREATE INDEX "deals_tenant_id_status_idx" ON "deals"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "deals_tenant_id_owner_id_idx" ON "deals"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_created_at_idx" ON "activities"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "activities_tenant_id_lead_id_idx" ON "activities"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_contact_id_idx" ON "activities"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "activities_tenant_id_deal_id_idx" ON "activities"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_status_idx" ON "tasks"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tasks_tenant_id_owner_id_status_idx" ON "tasks"("tenant_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_channel_idx" ON "conversations"("tenant_id", "channel");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_last_message_at_idx" ON "conversations"("tenant_id", "last_message_at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_conversation_id_at_idx" ON "messages"("tenant_id", "conversation_id", "at");

-- CreateIndex
CREATE INDEX "messages_tenant_id_lead_id_idx" ON "messages"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_contact_id_idx" ON "messages"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_external_id_idx" ON "messages"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_campaign_id_idx" ON "messages"("tenant_id", "campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_tenant_id_key_key" ON "whatsapp_templates"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "email_templates_tenant_id_idx" ON "email_templates"("tenant_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_idx" ON "tickets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_assignee_id_idx" ON "tickets"("tenant_id", "assignee_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_lead_id_idx" ON "tickets"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_sla_due_at_idx" ON "tickets"("tenant_id", "sla_due_at");

-- CreateIndex
CREATE INDEX "ticket_replies_tenant_id_ticket_id_idx" ON "ticket_replies"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "sla_policies_tenant_id_idx" ON "sla_policies"("tenant_id");

-- CreateIndex
CREATE INDEX "kb_articles_tenant_id_status_idx" ON "kb_articles"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "workflows_tenant_id_trigger_active_idx" ON "workflows"("tenant_id", "trigger", "active");

-- CreateIndex
CREATE INDEX "automation_runs_tenant_id_created_at_idx" ON "automation_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calls_twilio_call_sid_key" ON "voice_calls"("twilio_call_sid");

-- CreateIndex
CREATE UNIQUE INDEX "voice_calls_external_call_id_key" ON "voice_calls"("external_call_id");

-- CreateIndex
CREATE INDEX "voice_calls_tenant_id_created_at_idx" ON "voice_calls"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_calls_tenant_id_lead_id_idx" ON "voice_calls"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "voice_calls_tenant_id_agent_user_id_idx" ON "voice_calls"("tenant_id", "agent_user_id");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_agent_idx" ON "agent_runs"("tenant_id", "agent");

-- CreateIndex
CREATE INDEX "agent_runs_tenant_id_created_at_idx" ON "agent_runs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "agent_outreach_tenant_id_agent_status_idx" ON "agent_outreach"("tenant_id", "agent", "status");

-- CreateIndex
CREATE INDEX "agent_outreach_tenant_id_lead_id_idx" ON "agent_outreach"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "agent_outreach_tenant_id_agent_created_at_idx" ON "agent_outreach"("tenant_id", "agent", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_settings_tenant_id_agent_key" ON "agent_settings"("tenant_id", "agent");

-- CreateIndex
CREATE INDEX "agent_enrollments_tenant_id_agent_status_next_run_at_idx" ON "agent_enrollments"("tenant_id", "agent", "status", "next_run_at");

-- CreateIndex
CREATE INDEX "agent_enrollments_tenant_id_lead_id_idx" ON "agent_enrollments"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_status_idx" ON "invoices"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenant_id_number_key" ON "invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_status_gateway_idx" ON "payments"("status", "gateway");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_start_at_idx" ON "meetings"("tenant_id", "start_at");

-- CreateIndex
CREATE INDEX "meetings_tenant_id_owner_id_idx" ON "meetings"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "calendar_connections_tenant_id_user_id_idx" ON "calendar_connections"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_connections_tenant_id_user_id_provider_key" ON "calendar_connections"("tenant_id", "user_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "booking_links_tenant_id_slug_key" ON "booking_links"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_tenant_id_key_key" ON "integrations"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "webhooks_tenant_id_event_active_idx" ON "webhooks"("tenant_id", "event", "active");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_idx" ON "api_keys"("tenant_id");

-- CreateIndex
CREATE INDEX "api_keys_tenant_id_app_id_idx" ON "api_keys"("tenant_id", "app_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_action_idx" ON "audit_logs"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "lead_ingest_events_tenant_id_created_at_idx" ON "lead_ingest_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "lead_ingest_events_tenant_id_external_id_key" ON "lead_ingest_events"("tenant_id", "external_id");

-- CreateIndex
CREATE INDEX "activity_events_tenant_id_lead_id_occurred_at_idx" ON "activity_events"("tenant_id", "lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_tenant_id_contact_id_occurred_at_idx" ON "activity_events"("tenant_id", "contact_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_tenant_id_app_id_occurred_at_idx" ON "activity_events"("tenant_id", "app_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_events_tenant_id_app_id_anonymous_id_idx" ON "activity_events"("tenant_id", "app_id", "anonymous_id");

-- CreateIndex
CREATE INDEX "activity_events_tenant_id_created_at_idx" ON "activity_events"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "activity_events_tenant_id_idempotency_key_key" ON "activity_events"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_read_idx" ON "notifications"("tenant_id", "user_id", "read");

-- CreateIndex
CREATE INDEX "saved_views_tenant_id_user_id_resource_idx" ON "saved_views"("tenant_id", "user_id", "resource");

-- CreateIndex
CREATE INDEX "reminders_tenant_id_user_id_status_idx" ON "reminders"("tenant_id", "user_id", "status");

-- CreateIndex
CREATE INDEX "files_tenant_id_entity_type_entity_id_idx" ON "files"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "email_sending_domains_status_idx" ON "email_sending_domains"("status");

-- CreateIndex
CREATE UNIQUE INDEX "email_sending_domains_tenant_id_subdomain_key" ON "email_sending_domains"("tenant_id", "subdomain");

-- CreateIndex
CREATE INDEX "email_sender_identities_tenant_id_sending_domain_id_idx" ON "email_sender_identities"("tenant_id", "sending_domain_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_sender_identities_tenant_id_email_address_key" ON "email_sender_identities"("tenant_id", "email_address");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_ses_message_id_key" ON "email_messages"("ses_message_id");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_status_idx" ON "email_messages"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "email_messages_tenant_id_created_at_idx" ON "email_messages"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_messages_tenant_id_idempotency_key_key" ON "email_messages"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "email_suppressions_tenant_id_email_idx" ON "email_suppressions"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_tenant_id_email_category_scope_key" ON "email_suppressions"("tenant_id", "email", "category_scope");

-- CreateIndex
CREATE INDEX "email_reputation_events_tenant_id_created_at_idx" ON "email_reputation_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "email_domain_health_checks_tenant_id_sending_domain_id_crea_idx" ON "email_domain_health_checks"("tenant_id", "sending_domain_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_telephony_webhook_token_key" ON "tenant_telephony"("webhook_token");

-- CreateIndex
CREATE INDEX "tenant_telephony_tenant_id_idx" ON "tenant_telephony"("tenant_id");

-- CreateIndex
CREATE INDEX "telephony_numbers_tenant_id_idx" ON "telephony_numbers"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "telephony_numbers_tenant_id_phone_key" ON "telephony_numbers"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "tenant_razorpay_tenant_id_idx" ON "tenant_razorpay"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_stripe_tenant_id_idx" ON "tenant_stripe"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_whatsapp_tenant_id_idx" ON "tenant_whatsapp"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_whatsapp_waba_id_idx" ON "tenant_whatsapp"("waba_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_subscriptions_gateway_subscription_id_key" ON "tenant_subscriptions"("gateway_subscription_id");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_tenant_id_idx" ON "tenant_subscriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_status_idx" ON "tenant_subscriptions"("status");

-- CreateIndex
CREATE INDEX "tenant_subscriptions_current_period_end_idx" ON "tenant_subscriptions"("current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "platform_transactions_gateway_invoice_id_key" ON "platform_transactions"("gateway_invoice_id");

-- CreateIndex
CREATE INDEX "platform_transactions_tenant_id_idx" ON "platform_transactions"("tenant_id");

-- CreateIndex
CREATE INDEX "platform_transactions_subscription_id_idx" ON "platform_transactions"("subscription_id");

-- CreateIndex
CREATE INDEX "platform_transactions_status_idx" ON "platform_transactions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "plan_gateway_refs_plan_key_gateway_billing_interval_key" ON "plan_gateway_refs"("plan_key", "gateway", "billing_interval");

-- CreateIndex
CREATE UNIQUE INDEX "platform_webhook_events_event_id_key" ON "platform_webhook_events"("event_id");

-- CreateIndex
CREATE INDEX "platform_webhook_events_gateway_event_type_idx" ON "platform_webhook_events"("gateway", "event_type");

-- CreateIndex
CREATE INDEX "connected_apps_tenant_id_status_idx" ON "connected_apps"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "connected_apps_tenant_id_key_key" ON "connected_apps"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "products_tenant_id_status_idx" ON "products"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_idx" ON "products"("tenant_id", "category");

-- CreateIndex
CREATE INDEX "products_tenant_id_app_id_idx" ON "products"("tenant_id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_app_id_external_id_key" ON "products"("tenant_id", "app_id", "external_id");

-- CreateIndex
CREATE INDEX "product_prices_tenant_id_product_id_idx" ON "product_prices"("tenant_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_tenant_id_product_id_price_book_currency_bil_key" ON "product_prices"("tenant_id", "product_id", "price_book", "currency", "billing_period");

-- CreateIndex
CREATE INDEX "product_offers_tenant_id_product_id_status_idx" ON "product_offers"("tenant_id", "product_id", "status");

-- CreateIndex
CREATE INDEX "product_offers_tenant_id_status_ends_at_idx" ON "product_offers"("tenant_id", "status", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_offers_tenant_id_app_id_code_key" ON "product_offers"("tenant_id", "app_id", "code");

-- CreateIndex
CREATE INDEX "app_event_definitions_tenant_id_review_status_idx" ON "app_event_definitions"("tenant_id", "review_status");

-- CreateIndex
CREATE INDEX "app_event_definitions_tenant_id_app_id_idx" ON "app_event_definitions"("tenant_id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_event_definitions_tenant_id_app_id_name_key" ON "app_event_definitions"("tenant_id", "app_id", "name");

-- CreateIndex
CREATE INDEX "app_identities_tenant_id_lead_id_idx" ON "app_identities"("tenant_id", "lead_id");

-- CreateIndex
CREATE INDEX "app_identities_tenant_id_contact_id_idx" ON "app_identities"("tenant_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_identities_tenant_id_app_id_identity_type_identity_valu_key" ON "app_identities"("tenant_id", "app_id", "identity_type", "identity_value");

-- CreateIndex
CREATE INDEX "engagement_profiles_tenant_id_intent_band_last_seen_at_idx" ON "engagement_profiles"("tenant_id", "intent_band", "last_seen_at");

-- CreateIndex
CREATE INDEX "engagement_profiles_tenant_id_app_id_idx" ON "engagement_profiles"("tenant_id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_profiles_tenant_id_app_id_lead_id_key" ON "engagement_profiles"("tenant_id", "app_id", "lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "engagement_profiles_tenant_id_app_id_contact_id_key" ON "engagement_profiles"("tenant_id", "app_id", "contact_id");

-- CreateIndex
CREATE INDEX "deal_line_items_tenant_id_deal_id_idx" ON "deal_line_items"("tenant_id", "deal_id");

-- CreateIndex
CREATE INDEX "deal_line_items_tenant_id_product_id_idx" ON "deal_line_items"("tenant_id", "product_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_webhook_id_created_at_idx" ON "webhook_deliveries"("tenant_id", "webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "webhook_deliveries_status_next_retry_at_idx" ON "webhook_deliveries"("status", "next_retry_at");

-- AddForeignKey
ALTER TABLE "tenant_entitlements" ADD CONSTRAINT "tenant_entitlements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_documents" ADD CONSTRAINT "lead_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contracts" ADD CONSTRAINT "account_contracts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_contracts" ADD CONSTRAINT "account_contracts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_replies" ADD CONSTRAINT "ticket_replies_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_outreach" ADD CONSTRAINT "agent_outreach_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_settings" ADD CONSTRAINT "agent_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_enrollments" ADD CONSTRAINT "agent_enrollments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_connections" ADD CONSTRAINT "calendar_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_links" ADD CONSTRAINT "booking_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_ingest_events" ADD CONSTRAINT "lead_ingest_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sending_domains" ADD CONSTRAINT "email_sending_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sender_identities" ADD CONSTRAINT "email_sender_identities_sending_domain_id_fkey" FOREIGN KEY ("sending_domain_id") REFERENCES "email_sending_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_sender_identities" ADD CONSTRAINT "email_sender_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_reputation_events" ADD CONSTRAINT "email_reputation_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_domain_health_checks" ADD CONSTRAINT "email_domain_health_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_telephony" ADD CONSTRAINT "tenant_telephony_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telephony_numbers" ADD CONSTRAINT "telephony_numbers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_razorpay" ADD CONSTRAINT "tenant_razorpay_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_stripe" ADD CONSTRAINT "tenant_stripe_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_whatsapp" ADD CONSTRAINT "tenant_whatsapp_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_transactions" ADD CONSTRAINT "platform_transactions_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "tenant_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_transactions" ADD CONSTRAINT "platform_transactions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connected_apps" ADD CONSTRAINT "connected_apps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_offers" ADD CONSTRAINT "product_offers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_event_definitions" ADD CONSTRAINT "app_event_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_identities" ADD CONSTRAINT "app_identities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_profiles" ADD CONSTRAINT "engagement_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_line_items" ADD CONSTRAINT "deal_line_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

