import Redis from "ioredis";
import config from "../config";
import logger from "../utils/logger";

// Dedicated Redis connection(s) for BullMQ. BullMQ requires
// `maxRetriesPerRequest: null` (block until Redis is back) and the Worker holds
// a *blocking* connection, so these MUST be separate from the shared cache
// client in src/db/redis.ts (which uses maxRetriesPerRequest: 1 and fails fast).
//
// When Redis is unavailable (no REDIS_URL) or under tests, the queue is disabled
// and the scheduler falls back to in-process setInterval timers, so dev/test
// behaviour is unchanged.

const underTest = (): boolean =>
  process.env.VITEST === "true" || config.NODE_ENV === "test";

export const isQueueEnabled = (): boolean => !!config.REDIS_URL && !underTest();

const created: Redis[] = [];

// Creates a NEW ioredis connection suitable for BullMQ. Each BullMQ primitive
// (Queue, Worker) should get its own so the Worker's blocking reads never starve
// the Queue's commands. All created connections are tracked for shutdown.
export const createQueueConnection = (): Redis => {
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  client.on("error", (err) => logger.warn(`queue redis error: ${err.message}`));
  created.push(client);
  return client;
};

export const closeQueueConnections = async (): Promise<void> => {
  await Promise.all(created.map((c) => c.quit().catch(() => undefined)));
  created.length = 0;
};
