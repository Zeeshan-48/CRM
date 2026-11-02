# Tests

Three layers, fastest first. Reach for the lowest one that can actually prove the thing
you changed. The full guide, with what each file covers, is
[docs/guides/testing.md](../../../docs/guides/testing.md).

| Layer | Command | Needs a database |
| --- | --- | --- |
| `tests/unit`, `tests/*.test.ts` | `pnpm test` | no |
| `tests/mock` | `pnpm test` (same run) | no (in-memory Postgres) |
| `tests/api`, `tests/operator` | `pnpm test:integration` | **yes**, a local one, freshly migrated and seeded |

`pnpm test` is everything that works with no database, no Redis and no network. Run it
while you work; it is also what CI runs.

---

## tests/unit: pure functions

No I/O at all. Money maths, intent decay, offer windows, HMAC signing, payload mapping. If
the logic can be extracted into a pure function, it belongs here: these run in
milliseconds and never flake.

Injectable `now` is the convention, so time-dependent logic is deterministic:

```ts
expect(deriveAppHealth(row, FIXED_NOW).health).toBe("STALE");
```

---

## tests/mock: real SQL, in-memory database

Runs the **actual repositories and services** against [pg-mem], an in-memory Postgres.
Same Kysely queries, same SQL, same transactions, but each test gets a private database
that vanishes when it ends.

```ts
import { createMockDb, seedWorkspace, seedLead, seedApp } from "../mock-db";

const holder: { db: Kysely<DB> | null } = { db: null };

// Hoisted above the imports, so the repositories pick up the mock singleton.
vi.mock("../../src/db/connection", () => ({
  get db() { return holder.db!; },
  closeDB: async () => undefined,
  pool: {},
  waitForDBConnection: async () => undefined,
}));

const { default: productsRepository } = await import("../../src/repositories/products.repository");

beforeEach(async () => {
  mock = await createMockDb();
  holder.db = mock.db;
  ws = await seedWorkspace(mock.db);
});
afterEach(async () => { await mock.destroy(); });
```

Use this layer for anything the pure tests cannot reach: tenant scoping, upsert and
`onConflict` behaviour, transaction rollback, ordering across repositories, cascade
deletes.

### Keeping the schema current

`tests/mock-schema.ts` is generated from a migrated database and covers the tables listed
in `scripts/gen-mock-schema.ts`. After a schema change, migrate a local database and run:

```bash
pnpm gen:mock-schema     # reads DATABASE_URL
```

The generator is read-only (it reads `information_schema`) and never writes to the
database.

### What the mock does NOT reproduce

pg-mem is a reimplementation, not Postgres:

- **Enums are TEXT.** Query behaviour is identical because Kysely sends strings, but an
  invalid enum value will not be rejected.
- **No foreign keys.** The mock is for logic, not referential integrity.
- **Only unique indexes are carried over.** Those change behaviour (`onConflict`); plain
  performance indexes are irrelevant in memory.
- **No partial indexes**, and no real concurrency. Anything that depends on two cluster
  workers racing a conditional `UPDATE` needs `tests/api`.
- Some builtins are missing and are registered by hand in `mock-db.ts` (`GREATEST`,
  `LEAST`). If a query fails with "function does not exist", add it there rather than
  changing the production SQL.

---

## tests/api and tests/operator: the real thing

Drives the Express app in-process with supertest against a **real Postgres**. These catch
what the other layers cannot: middleware, auth, entitlement gating, real Postgres
semantics. No server is started and no background job runs.

### Setting up the database

Use a Postgres you own and nobody else uses: the suites write to it. Point
`apps/api/.env` at it (`PG_DATABASE_*` for the app and the seed, `DATABASE_URL` for the
migration runner; keep them the same database), then:

```bash
pnpm db:migrate              # from the repository root
pnpm demo:seed --force       # plans, root@example.com, Northwind Academy, Acme Robotics
pnpm test:integration
```

Leave `DEMO_PASSWORD` unset when seeding: the helpers sign in with the fixed fallback
passwords (`admin123`, `agent123`, `operator123`). `--force` wipes every tenant and the
operator users before reseeding, which is what you want for a test database and never what
you want for a real one (the seed refuses `NODE_ENV=production`).

Files run one at a time (`fileParallelism: false` in `vitest.config.ts`) because they
share the two seeded tenants. `tests/setup-env.ts` pins `TZ=UTC`, `NODE_ENV=test` and
test-only webhook secrets before any app code loads; every provider runs simulated and
rate limits are off.

### Establish state, never assume it

This is the rule that matters most here.

The suites share two real workspaces. Several of them mutate durable rows
(`tenants.config` such as the default payment gateway or working hours, the `roles` table,
`tenant_whatsapp`) and restore them in `afterAll`. That works right up until a run is
killed, an assertion throws before an inline cleanup line, or someone edits the same
setting in the UI. Then the workspace keeps the mutated value, and the next run fails
somewhere unrelated with a message that points at innocent code. For example:

- A suite left the workspace's default gateway on Stripe, so a *different* file's
  "defaults to Razorpay" failed on every subsequent run.
- A `roles` row overriding built-in `SALES_AGENT` granted `email`, so an RBAC test in
  another file stopped denying what it was written to deny.
- A conversion test deleted its rows on the line *after* a failing assertion, so a stray
  deal sat on the workspace and broke the pipeline-board test in a third file.

So, when a test depends on a setting:

```ts
beforeAll(async () => {
  saved = (await readConfig()).config;          // snapshot for the restore
  await writeConfig({ ...saved, gateway: null }); // and SET the state you need
});
afterAll(async () => { await writeConfig(saved); });
```

Snapshot-and-restore alone is not enough; the `beforeAll` must also put the workspace into
the state the assertions require. Then the suite passes from any starting point, including
a database left dirty by a previous crash. Equally: register created rows for `afterAll`
cleanup **before** you assert on them, never after.

Also:

- Namespace everything you create with a per-run random suffix.
- Clean up in `afterAll`, and prefer sweeping by that suffix over tracking ids by hand.
  Tracking ids misses the rows created as a side effect (a batch event, an orphan
  auto-create).
- When in doubt, `pnpm demo:seed --force` puts the database back to the canonical state.

### Test the contract, not a copy of it

Import shared constants instead of restating them (`DEAL_STAGE_NAMES`, agent definitions,
feature flags). A literal copy of a product decision goes stale silently, and a test
asserting a contract the product deliberately changed is worse than no test: it fails for
months and teaches everyone to ignore the suite. If a feature is switched off behind a
flag, skip against the imported flag (`describe.skipIf(FLAG)`) so the tests come back
automatically when it flips.

[pg-mem]: https://github.com/oguimbal/pg-mem
