-- Migration 0006: Soft Delete & Super Admin Vault
-- Adds deleted_at and deleted_by to key tenant business entities

-- 1. Leads
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "leads_tenant_deleted_idx" ON "leads"("tenant_id", "deleted_at");

-- 2. Contacts
ALTER TABLE "contacts"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "contacts_tenant_deleted_idx" ON "contacts"("tenant_id", "deleted_at");

-- 3. Deals
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "deals_tenant_deleted_idx" ON "deals"("tenant_id", "deleted_at");

-- 4. Accounts
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "accounts_tenant_deleted_idx" ON "accounts"("tenant_id", "deleted_at");

-- 5. Account Contracts
ALTER TABLE "account_contracts"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "account_contracts_tenant_deleted_idx" ON "account_contracts"("tenant_id", "deleted_at");

-- 6. Invoices
ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "invoices_tenant_deleted_idx" ON "invoices"("tenant_id", "deleted_at");

-- Partial unique index for Invoices so deleted invoices don't block future invoice numbers
DROP INDEX IF EXISTS "invoices_tenant_id_number_key";
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_tenant_id_number_active_key" 
  ON "invoices"("tenant_id", "number") 
  WHERE "deleted_at" IS NULL;

-- 7. Roles
ALTER TABLE "roles"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "deleted_by" TEXT NULL;
CREATE INDEX IF NOT EXISTS "roles_tenant_deleted_idx" ON "roles"("tenant_id", "deleted_at");

-- Partial unique index for Roles so deleted custom roles don't block reuse of key
DROP INDEX IF EXISTS "roles_tenant_id_key_key";
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_id_key_active_key" 
  ON "roles"("tenant_id", "key") 
  WHERE "deleted_at" IS NULL;

