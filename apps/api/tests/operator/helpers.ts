import { api, auth } from "../helpers";

// Operator console (platform tier) test helpers. Reuse the shared supertest
// `api` + `auth` from the tenant helpers, but log in against the operator
// console prefix (/api/v1/operator) which resolves operator_users, not tenant
// users.
export { api, auth };

export async function login(email: string, password: string): Promise<string> {
  const res = await api.post("/api/v1/operator/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`operator login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.token as string;
}

export const ROOT_OPERATOR = { email: "root@example.com", password: "operator123" };
