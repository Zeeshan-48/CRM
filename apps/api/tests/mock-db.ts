/**
 * In-memory Postgres for tests, so a suite can exercise real repositories and
 * services without a live database.
 *
 * Why this exists: every `tests/api/*` suite talks to the shared dev database.
 * That makes them slow, order-sensitive, impossible to run offline or in CI
 * without credentials, and it leaves rows behind when a test dies mid-way. The
 * mock runs the SAME SQL through pg-mem, so a repository bug still surfaces,
 * but each test gets a private database that vanishes when it ends.
 *
 * What it is NOT: a substitute for the API suites. pg-mem is a reimplementation
 * of Postgres, not Postgres. Anything depending on real engine behaviour
 * (concurrent CAS under a cluster, partial indexes, planner behaviour) still
 * belongs in tests/api.
 *
 *   import { createMockDb, seedWorkspace } from "../mock-db";
 *
 *   const mock = await createMockDb();
 *   const ws = await seedWorkspace(mock.db);
 *   ...
 *   await mock.destroy();
 */
import { Kysely, PostgresDialect } from "kysely";
import { newDb, type IMemoryDb } from "pg-mem";
import { ulid } from "ulid";
import type { DB } from "../src/db/types";
import { MOCK_SCHEMA_SQL } from "./mock-schema";

export interface MockDb {
  db: Kysely<DB>;
  /** The underlying pg-mem instance, for raw SQL assertions. */
  mem: IMemoryDb;
  destroy: () => Promise<void>;
}

/**
 * pg-mem does not implement every builtin. These are the ones our repositories
 * actually use; each is registered rather than worked around, so the production
 * SQL under test stays byte-identical to what runs against real Postgres.
 */
const registerMissingFunctions = (mem: IMemoryDb): void => {
  for (const type of ["timestamp", "int", "text"] as const) {
    mem.public.registerFunction({
      name: "greatest",
      args: [type, type],
      returns: type,
      implementation: (a: unknown, b: unknown) => {
        if (a === null || a === undefined) return b;
        if (b === null || b === undefined) return a;
        return (a as number) > (b as number) ? a : b;
      },
    });
    mem.public.registerFunction({
      name: "least",
      args: [type, type],
      returns: type,
      implementation: (a: unknown, b: unknown) => {
        if (a === null || a === undefined) return b;
        if (b === null || b === undefined) return a;
        return (a as number) < (b as number) ? a : b;
      },
    });
  }
};

/** A fresh, isolated in-memory database with the schema applied. */
export const createMockDb = async (): Promise<MockDb> => {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  registerMissingFunctions(mem);
  mem.public.none(MOCK_SCHEMA_SQL);

  const { Pool } = mem.adapters.createPg();
  const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool() }) });

  return {
    db,
    mem,
    destroy: async () => {
      await db.destroy();
    },
  };
};

export interface Workspace {
  tenantId: string;
  userId: string;
  pipelineId: string;
  stageId: string;
}

/**
 * The minimum a product-integration test needs: one tenant, one active admin,
 * and a default pipeline with a first stage (deals need both).
 */
export const seedWorkspace = async (db: Kysely<DB>): Promise<Workspace> => {
  const now = new Date();
  const tenantId = ulid();
  const userId = ulid();
  const pipelineId = ulid();
  const stageId = ulid();

  await db
    .insertInto("tenants")
    .values({
      id: tenantId,
      slug: `mock-${tenantId.slice(-6).toLowerCase()}`,
      name: "Mock Workspace",
      brand_color: "#b6207f",
      white_label: false,
      status: "ACTIVE",
      config: null,
      email_sending_status: "ACTIVE",
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto("users")
    .values({
      id: userId,
      tenant_id: tenantId,
      name: "Mock Admin",
      email: `admin@${tenantId.slice(-6).toLowerCase()}.test`,
      password_hash: "x",
      role: "ADMIN",
      status: "ACTIVE",
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto("pipelines")
    .values({
      id: pipelineId,
      tenant_id: tenantId,
      name: "Sales",
      is_default: true,
      created_at: now,
      updated_at: now,
    })
    .execute();

  await db
    .insertInto("stages")
    .values({
      id: stageId,
      tenant_id: tenantId,
      pipeline_id: pipelineId,
      name: "New",
      sort_order: 0,
      won: false,
      lost: false,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { tenantId, userId, pipelineId, stageId };
};

/** Inserts a lead directly, bypassing the service (no entitlements, no scoring). */
export const seedLead = async (
  db: Kysely<DB>,
  tenantId: string,
  over: Partial<{ name: string; email: string; phone: string }> = {}
): Promise<string> => {
  const now = new Date();
  const id = ulid();
  await db
    .insertInto("leads")
    .values({
      id,
      tenant_id: tenantId,
      name: over.name ?? "Mock Lead",
      email: over.email ?? `lead.${id.slice(-6).toLowerCase()}@example.test`,
      phone: over.phone ?? null,
      country: "India",
      status: "NEW",
      budget: false,
      score_total: 0,
      score_grade: "COLD",
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
};

/** Inserts a connected product directly. */
export const seedApp = async (
  db: Kysely<DB>,
  tenantId: string,
  over: Partial<{ key: string; name: string; environment: string }> = {}
): Promise<string> => {
  const now = new Date();
  const id = ulid();
  await db
    .insertInto("connected_apps")
    .values({
      id,
      tenant_id: tenantId,
      key: over.key ?? `app-${id.slice(-6).toLowerCase()}`,
      name: over.name ?? "Mock Product",
      status: "ACTIVE",
      environment: over.environment ?? "LIVE",
      capabilities: JSON.stringify({ events: true, identity: true, catalog: true }),
      catalog_mode: "PUSH",
      allowed_origins: JSON.stringify([]),
      health: "PENDING",
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
};
