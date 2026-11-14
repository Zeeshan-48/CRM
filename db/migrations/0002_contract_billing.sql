-- AlterTable account_contracts: add billing_type, recurring_interval, recurring_value, milestones
ALTER TABLE "account_contracts"
  ADD COLUMN IF NOT EXISTS "billing_type" TEXT NOT NULL DEFAULT 'ONE_TIME',
  ADD COLUMN IF NOT EXISTS "recurring_interval" TEXT DEFAULT 'ANNUAL',
  ADD COLUMN IF NOT EXISTS "recurring_value" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "milestones" JSONB NOT NULL DEFAULT '[]'::jsonb;

