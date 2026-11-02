import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against a running local stack (`make up && make demo`, or the
 * dev servers): the workspace app, the operator console, the API (with its in-process
 * background jobs), Postgres, Redis and the Floci emulator. Every provider (WhatsApp,
 * Twilio, Exotel, Razorpay, Stripe, platform billing) runs simulated and AI uses the
 * deterministic offline engine, so results are reproducible.
 *
 *   pnpm e2e                                         every spec
 *   pnpm e2e e2e/tests/leads.spec.ts                 one spec
 *   E2E_HEADED=1 pnpm e2e                            watch it
 *
 * Env: E2E_BASE_URL (the workspace app), E2E_CONSOLE_URL (the operator console),
 * E2E_API_URL (the API including /api/v1), E2E_MAILPIT_URL.
 *
 * The specs share the two seeded demo tenants, so they run one file at a time and each
 * spec cleans up what it creates.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: ".report", open: "never" }]],
  outputDir: ".results",
  globalSetup: "./global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3570",
    trace: process.env.CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    headless: !process.env.E2E_HEADED,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
