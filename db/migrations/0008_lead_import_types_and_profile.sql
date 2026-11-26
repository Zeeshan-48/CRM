ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "import_type" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "extra_fields" JSONB;
CREATE INDEX IF NOT EXISTS "leads_tenant_id_import_type_idx" ON "leads" ("tenant_id", "import_type");
