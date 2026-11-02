/**
 * Creates the first operator (SUPERADMIN) on a fresh deployment, where the
 * demo seed must not run. Prints a generated password once; the operator signs
 * in to the console with it, changes it under Profile, and then creates plans
 * and onboards tenants.
 *
 *   node dist-scripts/scripts/bootstrap-operator.js --email ops@example.com [--name "Ops Lead"]
 *
 * Refuses when that email already exists, so it is safe to run twice.
 */
process.env.TZ = "UTC";

import crypto from "crypto";
import bcrypt from "bcrypt";
import { ulid } from "ulid";
import { closeDB, db } from "../src/db/connection";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const email = (arg("email") ?? "").trim().toLowerCase();
  const name = (arg("name") ?? "Platform Operator").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('usage: bootstrap-operator --email ops@example.com [--name "Ops Lead"]');
  }

  const existing = await db
    .selectFrom("operator_users")
    .select(["id"])
    .where("email", "=", email)
    .executeTakeFirst();
  if (existing) {
    console.log(`[bootstrap] operator ${email} already exists; nothing changed`);
    return;
  }

  const password = crypto.randomBytes(18).toString("base64url");
  const t = new Date();
  await db
    .insertInto("operator_users")
    .values({
      id: ulid(),
      email,
      name,
      password_hash: await bcrypt.hash(password, 12),
      role: "SUPERADMIN",
      status: "ACTIVE",
      created_at: t,
      updated_at: t,
    })
    .execute();

  console.log(`[bootstrap] SUPERADMIN ${email} created`);
  console.log(`[bootstrap] one-time password: ${password}`);
  console.log("[bootstrap] sign in to the operator console and change it under Profile.");
}

main()
  .catch((err) => {
    console.error("[bootstrap] FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDB());
