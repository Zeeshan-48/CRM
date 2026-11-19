-- Migration 0007: Add invoice_settings to tenant_billing_profiles
-- Allows Super Admin to customize invoice theme, accent colors, display toggles,
-- payment terms, and declarations on a per-tenant basis.

ALTER TABLE "tenant_billing_profiles" 
ADD COLUMN IF NOT EXISTS "invoice_settings" JSONB DEFAULT '{}'::jsonb;
