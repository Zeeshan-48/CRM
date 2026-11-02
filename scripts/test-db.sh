#!/usr/bin/env bash
# Make sure a disposable Postgres and Redis are reachable for the integration tests,
# then drop and recreate the test database (default crm_test) so the run starts from
# an empty schema. `make test-integration` migrates and seeds it next: the API tests
# sign in as the seeded demo users.
#
#   scripts/test-db.sh [database]      the name must end in _test
#
# Host ports follow CRM_PG_PORT (5532) and CRM_REDIS_PORT (6469). When something
# already answers on both (the compose stack, or any Postgres that accepts crm/crm),
# nothing is started; otherwise the compose postgres and redis services are.
set -euo pipefail
cd "$(dirname "$0")/.."
db="${1:-crm_test}"
pg_port="${CRM_PG_PORT:-5532}"
redis_port="${CRM_REDIS_PORT:-6469}"

[[ "$db" =~ ^[a-z0-9_]+_test$ ]] || { echo "refusing to recreate '$db': the name must end in _test"; exit 2; }

listening() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

if ! { listening "$pg_port" && listening "$redis_port"; }; then
  scripts/gen-local-env.sh >/dev/null # creates .env, or adds keys an older one lacks
  docker compose --env-file deploy/compose/.env -f deploy/compose/compose.yaml up -d --wait postgres redis >/dev/null
fi

# pg comes from the root devDependencies (pnpm install).
PGPORT="$pg_port" TEST_DB="$db" node -e '
  const { Client } = require("pg");
  const db = process.env.TEST_DB;
  const c = new Client({ host: "127.0.0.1", port: Number(process.env.PGPORT), user: "crm", password: "crm", database: "postgres" });
  (async () => {
    await c.connect();
    await c.query(`DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`);
    await c.query(`CREATE DATABASE "${db}"`);
    await c.end();
    console.log(`recreated ${db} on 127.0.0.1:${process.env.PGPORT}`);
  })().catch((e) => { console.error(`test database: ${e.message}`); process.exit(1); });
'
