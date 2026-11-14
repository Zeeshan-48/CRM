-- AlterTable accounts: add project_name
ALTER TABLE "accounts"
  ADD COLUMN IF NOT EXISTS "project_name" TEXT;

