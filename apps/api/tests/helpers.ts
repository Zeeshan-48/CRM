import supertest from "supertest";
import app from "../src/app";

// Supertest drives the Express app in-process; no listening server needed.
// Tests run against a freshly migrated and seeded database (pnpm demo:seed) and clean up what
// they create. vitest.config.ts disables file parallelism so cross-file
// writes never race.
export const api = supertest(app);

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function login(email: string, password: string): Promise<string> {
  const res = await api.post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token as string;
}

export const NW_ADMIN = { email: "maya@northwind.example.com", password: "admin123" };
export const NW_SALES = { email: "asha@northwind.example.com", password: "agent123" };
export const NW_SUPPORT = { email: "ravi@northwind.example.com", password: "agent123" };
export const NW_MARKETING = { email: "meera@northwind.example.com", password: "agent123" };
export const NW_FINANCE = { email: "anil@northwind.example.com", password: "agent123" };
export const ACME_ADMIN = { email: "arjun@acme.example.com", password: "admin123" };
export const NW_MANAGER = { email: "vikram@northwind.example.com", password: "manager123" };
