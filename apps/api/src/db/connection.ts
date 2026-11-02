// Belt-and-braces UTC pin: index.ts sets this for the server process, but
// other entrypoints (vitest, scripts) import this module directly and pg
// serializes Date objects using local-time getters.
process.env.TZ = "UTC";

import pg, { Pool, PoolConfig } from "pg";
import { Kysely, PostgresDialect } from "kysely";
import config from "../config";
import logger from "../utils/logger";
import type { DB } from "./types";

// `timestamp without time zone` (oid 1114) must be read as UTC. Without this
// parser pg interprets it in the server's local timezone and every stored
// timestamp shifts. Writes are kept UTC by process.env.TZ = "UTC" in index.ts.
pg.types.setTypeParser(1114, (val: string) => new Date(val + "+00"));

const getPoolConfig = (): PoolConfig => {
  const isProd = config.isProduction;
  return {
    host: config.PG_DATABASE_HOST,
    user: config.PG_DATABASE_USER,
    password: config.PG_DATABASE_PASSWORD,
    port: Number(config.PG_DATABASE_PORT),
    database: config.PG_DATABASE,
    application_name: `open-crm-api-${process.pid}`,
    keepAlive: true,
    max: config.PG_POOL_MAX ? Number(config.PG_POOL_MAX) : isProd ? 8 : 10,
    min: config.PG_POOL_MIN ? Number(config.PG_POOL_MIN) : 0,
    connectionTimeoutMillis: config.PG_CONNECTION_TIMEOUT
      ? Number(config.PG_CONNECTION_TIMEOUT)
      : 15000,
    idleTimeoutMillis: config.PG_IDLE_TIMEOUT ? Number(config.PG_IDLE_TIMEOUT) : 10000,
    statement_timeout: 30000,
  };
};

export const pool = new Pool(getPoolConfig());

pool.on("error", (err) => {
  logger.error(`[pg-pool] idle client error: ${err.message}`);
});

export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });

export const waitForDBConnection = async (attempts = 5, baseDelayMs = 500): Promise<void> => {
  for (let i = 0; i < attempts; i++) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
        logger.info("Database connected");
        return;
      } finally {
        client.release();
      }
    } catch (_error) {
      const delay = baseDelayMs * Math.pow(2, i);
      logger.warn(`Database connection attempt ${i + 1}/${attempts} failed; retrying in ${delay}ms`);
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Database connection failed after retries");
};

export const closeDB = async (): Promise<void> => {
  await db.destroy();
};
