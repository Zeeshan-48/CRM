import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import {
  api,
  auth,
  ACME_ADMIN,
  NW_ADMIN,
  NW_FINANCE,
  NW_SALES,
  login,
} from "../helpers";

const MARK = `kb${Date.now()}`;

let adminToken: string;
let salesToken: string;
let financeToken: string;
let esAdminToken: string;
const createdArticleIds: string[] = [];

const createArticle = async (payload: Record<string, unknown>) => {
  const res = await api.post("/api/v1/kb").set(auth(adminToken)).send(payload);
  expect(res.status).toBe(201);
  createdArticleIds.push(res.body.data.id);
  return res.body.data;
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
});

afterAll(async () => {
  if (createdArticleIds.length) {
    await db.deleteFrom("kb_articles").where("id", "in", createdArticleIds).execute();
  }
  await closeDB();
});

describe("kb articles", () => {
  it("lists seeded articles for the tenant", async () => {
    const res = await api.get("/api/v1/kb").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6);
    const refund = res.body.data.find((a: { title: string }) => a.title === "Refund policy");
    expect(refund).toBeTruthy();
    expect(refund.status).toBe("PUBLISHED");
  });

  it("creates an article defaulting to PUBLISHED", async () => {
    const article = await createArticle({
      title: `${MARK} How to reset your password`,
      body: "Go to settings, click reset password, and follow the email link.",
      tags: ["password", "reset"],
    });
    expect(article.status).toBe("PUBLISHED");
    expect(article.views).toBe(0);
    expect(article.tags).toEqual(["password", "reset"]);
  });

  it("requires title and body and validates status", async () => {
    const noTitle = await api
      .post("/api/v1/kb")
      .set(auth(adminToken))
      .send({ body: "body only" });
    expect(noTitle.status).toBe(400);

    const noBody = await api
      .post("/api/v1/kb")
      .set(auth(adminToken))
      .send({ title: `${MARK} title only` });
    expect(noBody.status).toBe(400);

    const badStatus = await api
      .post("/api/v1/kb")
      .set(auth(adminToken))
      .send({ title: `${MARK} bad`, body: "text", status: "BOGUS" });
    expect(badStatus.status).toBe(400);
  });

  it("filters the list by status", async () => {
    const draft = await createArticle({
      title: `${MARK} internal runbook`,
      body: "Steps for the support team only.",
      status: "DRAFT",
    });

    const drafts = await api.get("/api/v1/kb?status=DRAFT").set(auth(adminToken));
    expect(drafts.status).toBe(200);
    expect(drafts.body.data.every((a: { status: string }) => a.status === "DRAFT")).toBe(true);
    expect(drafts.body.data.some((a: { id: string }) => a.id === draft.id)).toBe(true);

    const published = await api.get("/api/v1/kb?status=PUBLISHED").set(auth(adminToken));
    expect(
      published.body.data.every((a: { status: string }) => a.status === "PUBLISHED")
    ).toBe(true);
    expect(published.body.data.some((a: { id: string }) => a.id === draft.id)).toBe(false);

    const invalid = await api.get("/api/v1/kb?status=BOGUS").set(auth(adminToken));
    expect(invalid.status).toBe(400);
  });
});

describe("kb search", () => {
  it("returns ragSearch hits over PUBLISHED articles", async () => {
    const res = await api
      .post("/api/v1/kb/search")
      .set(auth(adminToken))
      .send({ query: "refund for duplicate payment" });
    expect(res.status).toBe(200);
    expect(res.body.data.query).toBe("refund for duplicate payment");
    expect(res.body.data.results.length).toBeGreaterThanOrEqual(1);
    const top = res.body.data.results[0];
    expect(top.article.title).toBe("Refund policy");
    expect(top.score).toBeGreaterThanOrEqual(2);
    expect(top.snippet.length).toBeGreaterThan(0);
  });

  it("does not surface DRAFT articles in search", async () => {
    await createArticle({
      title: `${MARK} flibberwock guide`,
      body: "flibberwock handling steps for internal use",
      status: "DRAFT",
    });
    const res = await api
      .post("/api/v1/kb/search")
      .set(auth(adminToken))
      .send({ query: "flibberwock" });
    expect(res.status).toBe(200);
    expect(res.body.data.results.length).toBe(0);
  });

  it("requires a query", async () => {
    const res = await api.post("/api/v1/kb/search").set(auth(adminToken)).send({});
    expect(res.status).toBe(400);
  });
});

describe("kb detail", () => {
  it("returns the article and increments views atomically", async () => {
    const article = await createArticle({
      title: `${MARK} view counter`,
      body: "Each read bumps the counter exactly once.",
    });

    const first = await api.get(`/api/v1/kb/${article.id}`).set(auth(salesToken));
    expect(first.status).toBe(200);
    expect(first.body.data.views).toBe(1);

    const second = await api.get(`/api/v1/kb/${article.id}`).set(auth(salesToken));
    expect(second.body.data.views).toBe(2);
  });

  it("returns 404 for cross-tenant article access without counting a view", async () => {
    const article = await createArticle({
      title: `${MARK} tenant scoped`,
      body: "Only northwind should read this.",
    });

    const res = await api.get(`/api/v1/kb/${article.id}`).set(auth(esAdminToken));
    expect(res.status).toBe(404);

    const row = await db
      .selectFrom("kb_articles")
      .select(["views"])
      .where("id", "=", article.id)
      .executeTakeFirstOrThrow();
    expect(row.views).toBe(0);
  });
});

describe("kb RBAC", () => {
  it("denies the FINANCE role access to kb", async () => {
    const res = await api.get("/api/v1/kb").set(auth(financeToken));
    expect(res.status).toBe(403);
  });
});
