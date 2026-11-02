import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    globals: false,
    // API tests share the two seeded tenants in the local test database; run
    // files sequentially so cross-file writes never race.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
