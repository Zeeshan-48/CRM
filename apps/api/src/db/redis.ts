import Redis from "ioredis";
import config from "../config";
import logger from "../utils/logger";

// Optional Redis used for the send resolver cache and per-tenant rate limiting.
// Disabled when REDIS_URL is unset or under tests. All callers fail open, so a
// missing or down Redis never breaks a request.
let client: Redis | null = null;

const underTest = process.env.VITEST === "true" || config.NODE_ENV === "test";

if (config.REDIS_URL && !underTest) {
  client = new Redis(config.REDIS_URL, {
    // Fail fast instead of queueing when Redis is unreachable, so callers can
    // fall back immediately.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on("connect", () => logger.info("Redis connected"));
  client.on("error", (err) => logger.warn(`Redis error: ${err.message}`));
} else {
  logger.info(`Redis disabled (${underTest ? "test mode" : "REDIS_URL unset"})`);
}

export const getRedis = (): Redis | null => client;

export const isRedisReady = (): boolean => client?.status === "ready";

export const closeRedis = async (): Promise<void> => {
  if (client) {
    await client.quit().catch(() => undefined);
    client = null;
  }
};
