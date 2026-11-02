/**
 * Wait until the stack answers before the first test: `make up` returns as soon as the
 * containers report healthy, and the first requests can still race the API's warm-up.
 * Polls the API health check and both single-page apps.
 */
import fs from "node:fs";
import path from "node:path";
import { API, API_ORIGIN, CONSOLE, DEMO, OPERATOR_API, SESSIONS_FILE, WEB } from "./helpers";

async function ready(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return r.ok;
  } catch {
    return false;
  }
}

export default async function globalSetup(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (const url of [`${API_ORIGIN}/api/health`, `${WEB}/`, `${CONSOLE}/`]) {
    let ok = await ready(url);
    while (!ok && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      ok = await ready(url);
    }
    if (!ok) throw new Error(`${url} did not answer within 90 seconds: is the stack up (make up)?`);
  }

  // One API sign-in per demo account for the whole run, shared through a file:
  // the sign-in rate limit (10 per IP per 5 minutes) would trip if every test
  // signed in on its own.
  const accounts = [
    ["web", DEMO.northwindAdmin()],
    ["web", DEMO.acmeAdmin()],
    ["console", DEMO.operator()],
  ] as const;
  const sessions: Record<string, unknown> = {};
  for (const [app, account] of accounts) {
    const base = app === "console" ? OPERATOR_API : API;
    const r = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(account),
    });
    if (!r.ok) throw new Error(`sign-in for ${account.email} failed: ${r.status} ${await r.text()}`);
    sessions[`${app}:${account.email}`] = ((await r.json()) as { data: unknown }).data;
  }
  fs.mkdirSync(path.dirname(SESSIONS_FILE), { recursive: true });
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
}
