import { ulid } from "ulid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDB, db } from "../../src/db/connection";
import agentsService, {
  AGENT_DEFINITIONS,
  HIDDEN_AGENT_KEYS,
} from "../../src/services/agents.service";
import entitlementsService from "../../src/services/entitlements.service";
import { api, auth, ACME_ADMIN, NW_ADMIN, NW_FINANCE, NW_SALES, login } from "../helpers";

const ts = Date.now();
const SALES_LEAD = `Agent Sales Lead ${ts}`;
const MKT_LEAD = `Agent Marketing Lead ${ts}`;
const MKT_TAG = `agent-tag-${ts}`;
const COLL_CONTACT = `Collections Contact ${ts}`;
const SUCC_CONTACT = `Success Contact ${ts}`;
const TICKET_SUBJECT = `Refund request duplicate payment ${ts}`;
const INVOICE_NUMBER = `INV-AGT-${ts}`;
const testStart = new Date();

let adminToken: string;
let esAdminToken: string;
let salesToken: string;
let financeToken: string;
let nwTenantId: string;
let salesLeadId: string;
let mktLeadId: string;
let collContactId: string;
let succContactId: string;
let ticketId: string;
let invoiceId: string;
const runIds: string[] = [];
const outreachIds: string[] = [];
// The sales automation only runs inside the workspace's working hours, so these
// tests pin an always-open window (and restore the tenant config afterwards).
let savedTenantConfig: unknown = null;

const setWorkingHours = async (hours: {
  timezone: string;
  days: number[];
  start: string;
  end: string;
}) => {
  const row = await db
    .selectFrom("tenants")
    .select("config")
    .where("id", "=", nwTenantId)
    .executeTakeFirst();
  const config =
    row?.config && typeof row.config === "object"
      ? { ...(row.config as Record<string, unknown>) }
      : {};
  config.scheduling = hours;
  await db
    .updateTable("tenants")
    .set({ config: JSON.stringify(config) })
    .where("id", "=", nwTenantId)
    .execute();
};

const ALWAYS_OPEN = {
  timezone: "Asia/Kolkata",
  days: [0, 1, 2, 3, 4, 5, 6],
  start: "00:00",
  end: "23:59",
};

beforeAll(async () => {
  adminToken = await login(NW_ADMIN.email, NW_ADMIN.password);
  esAdminToken = await login(ACME_ADMIN.email, ACME_ADMIN.password);
  salesToken = await login(NW_SALES.email, NW_SALES.password);
  financeToken = await login(NW_FINANCE.email, NW_FINANCE.password);

  const tenant = await db
    .selectFrom("tenants")
    .select(["id"])
    .where("slug", "=", "northwind")
    .executeTakeFirstOrThrow();
  nwTenantId = tenant.id;
  savedTenantConfig =
    (
      await db
        .selectFrom("tenants")
        .select("config")
        .where("id", "=", nwTenantId)
        .executeTakeFirst()
    )?.config ?? null;
  // Keep the automation tests deterministic regardless of when the suite runs.
  await setWorkingHours(ALWAYS_OPEN);
  const now = new Date();

  // Fixtures are crafted to rank FIRST in each agent's query (newest, highest
  // score, lowest progress), so limit=1 runs touch only rows this suite owns.
  salesLeadId = ulid();
  mktLeadId = ulid();
  await db
    .insertInto("leads")
    .values([
      {
        id: salesLeadId,
        tenant_id: nwTenantId,
        name: SALES_LEAD,
        email: "agent.sales@example.com",
        phone: "+919000000001",
        city: "Bengaluru",
        source: "Referral",
        status: "NEW",
        owner_id: null,
        tags: JSON.stringify([]),
        notes: "",
        score_total: 100,
        score_grade: "HOT",
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      },
      {
        id: mktLeadId,
        tenant_id: nwTenantId,
        name: MKT_LEAD,
        email: "agent.mkt@example.com",
        phone: "+919000000002",
        city: "Pune",
        source: "WhatsApp",
        status: "NEW",
        owner_id: null,
        tags: JSON.stringify([MKT_TAG]),
        notes: "",
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();

  collContactId = ulid();
  succContactId = ulid();
  await db
    .insertInto("contacts")
    .values([
      {
        id: collContactId,
        tenant_id: nwTenantId,
        name: COLL_CONTACT,
        email: "agent.coll@example.com",
        created_at: now,
        updated_at: now,
      },
      {
        id: succContactId,
        tenant_id: nwTenantId,
        name: SUCC_CONTACT,
        email: "agent.succ@example.com",
        created_at: now,
        updated_at: now,
      },
    ])
    .execute();

  invoiceId = ulid();
  await db
    .insertInto("invoices")
    .values({
      id: invoiceId,
      tenant_id: nwTenantId,
      number: INVOICE_NUMBER,
      contact_id: collContactId,
      amount: 50000,
      tax: 9000,
      status: "OVERDUE",
      issued_at: new Date(Date.now() - 10 * 86400000),
      due_at: new Date(Date.now() - 3 * 86400000),
      created_at: now,
      updated_at: now,
    })
    .execute();


  ticketId = ulid();
  await db
    .insertInto("tickets")
    .values({
      id: ticketId,
      tenant_id: nwTenantId,
      subject: TICKET_SUBJECT,
      body: "I paid twice and need a refund of the duplicate payment.",
      priority: "HIGH",
      status: "OPEN",
      channel: "email",
      created_at: now,
      updated_at: now,
    })
    .execute();
});

afterAll(async () => {
  // Audit and lead-rescore writes are fire-and-forget; let them settle first.
  await new Promise((r) => setTimeout(r, 300));
  await db
    .deleteFrom("messages")
    .where((eb) =>
      eb.or([
        eb("lead_id", "in", [salesLeadId, mktLeadId]),
        eb("contact_id", "in", [collContactId, succContactId]),
      ])
    )
    .execute();
  await db
    .deleteFrom("conversations")
    .where((eb) =>
      eb.or([
        eb("lead_id", "in", [salesLeadId, mktLeadId]),
        eb("contact_id", "in", [collContactId, succContactId]),
      ])
    )
    .execute();
  await db.deleteFrom("tasks").where("lead_id", "=", salesLeadId).execute();
  if (outreachIds.length) {
    await db.deleteFrom("audit_logs").where("entity_id", "in", outreachIds).execute();
  }
  // Phase 2: remove any enrollments/drafts the automation created this run
  // (scoped to rows created during the test), plus the tenant's settings row.
  await db
    .deleteFrom("agent_enrollments")
    .where("tenant_id", "=", nwTenantId)
    .where("agent", "=", "sales")
    .where("created_at", ">=", testStart)
    .execute();
  await db
    .deleteFrom("agent_outreach")
    .where("tenant_id", "=", nwTenantId)
    .where("agent", "=", "sales")
    .where("created_at", ">=", testStart)
    .execute();
  await db
    .deleteFrom("agent_outreach")
    .where("lead_id", "in", [salesLeadId, mktLeadId])
    .execute();
  await db
    .deleteFrom("agent_settings")
    .where("tenant_id", "=", nwTenantId)
    .where("agent", "=", "sales")
    .execute();
  await db
    .updateTable("tenants")
    .set({ config: savedTenantConfig === null ? null : JSON.stringify(savedTenantConfig) })
    .where("id", "=", nwTenantId)
    .execute();
  await db.deleteFrom("ticket_replies").where("ticket_id", "=", ticketId).execute();
  await db.deleteFrom("tickets").where("id", "=", ticketId).execute();
  // The collections agent may create real payment-link rows for the invoice.
  await db.deleteFrom("payments").where("invoice_id", "=", invoiceId).execute();
  await db.deleteFrom("invoices").where("id", "=", invoiceId).execute();
  await db.deleteFrom("contacts").where("id", "in", [collContactId, succContactId]).execute();
  await db.deleteFrom("leads").where("id", "in", [salesLeadId, mktLeadId]).execute();
  if (runIds.length) {
    await db.deleteFrom("audit_logs").where("entity_id", "in", runIds).execute();
    await db.deleteFrom("agent_runs").where("id", "in", runIds).execute();
  }
  await closeDB();
});

describe("agents module", () => {
  it("lists the surfaced agents with run stats", async () => {
    const res = await api.get("/api/v1/agents").set(auth(adminToken));
    expect(res.status).toBe(200);
    const keys = res.body.data.map((a: { key: string }) => a.key);
    // Derived from the registry rather than restated, so hiding or surfacing an
    // agent does not require editing this list. Hidden agents stay runnable, // they are only absent from the picker.
    expect(keys).toEqual(
      AGENT_DEFINITIONS.filter((d) => !HIDDEN_AGENT_KEYS.has(d.key)).map((d) => d.key)
    );
    for (const hidden of HIDDEN_AGENT_KEYS) {
      expect(keys).not.toContain(hidden);
    }
    for (const agent of res.body.data) {
      expect(agent.name).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(typeof agent.runCount).toBe("number");
      expect(agent).toHaveProperty("lastRunAt");
    }
  });

  it("SALES_AGENT can reach agents: running the sales agent is their job", async () => {
    const res = await api.get("/api/v1/agents").set(auth(salesToken));
    expect(res.status).toBe(200);
  });

  it("a role without the agents module is denied", async () => {
    // FINANCE holds finance/analytics/accounts/copilot and nothing else, so it is
    // the honest negative case now that SALES_AGENT legitimately has `agents`.
    const res = await api.get("/api/v1/agents").set(auth(financeToken));
    expect(res.status).toBe(403);
  });

  it("rejects unknown agents", async () => {
    const res = await api.post("/api/v1/agents/terminator/run").set(auth(adminToken));
    expect(res.status).toBe(400);
  });

  it("sales agent drafts outreach for review without sending", async () => {
    const res = await api.post("/api/v1/agents/sales/run?limit=1").set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.agent).toBe("sales");
    // Phase 1: the agent DRAFTS, it does not send on run.
    expect(data.summary).toContain("Drafted 1 message");
    expect(data.actions[0]).toContain(SALES_LEAD);

    // A DRAFT outreach row exists, but NO message and NO task yet.
    const draft = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .executeTakeFirst();
    expect(draft?.status).toBe("DRAFT");
    expect(draft?.agent).toBe("sales");
    expect(draft?.body).toContain("book you a quick demo");
    if (draft) outreachIds.push(draft.id);

    const preMessage = await db
      .selectFrom("messages")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .executeTakeFirst();
    expect(preMessage).toBeUndefined();
    const preTask = await db
      .selectFrom("tasks")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .executeTakeFirst();
    expect(preTask).toBeUndefined();
  });

  it("sales agent does not re-draft a lead with a pending draft (cooldown)", async () => {
    const res = await api.post("/api/v1/agents/sales/run?limit=1").set(auth(adminToken));
    expect(res.status).toBe(200);
    runIds.push(res.body.data.run.id);
    const drafts = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("status", "=", "DRAFT")
      .execute();
    // Still exactly one draft, the pending one was not duplicated.
    expect(drafts).toHaveLength(1);
  });

  it("approving a draft sends it and opens a follow-up task", async () => {
    const draft = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("status", "=", "DRAFT")
      .executeTakeFirstOrThrow();
    const res = await api
      .post(`/api/v1/agents/outreach/${draft.id}/approve`)
      .set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.outreach.status).toBe("SENT");

    // The lead has a phone, so it delivers over WhatsApp (simulated under test).
    const message = await db
      .selectFrom("messages")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .executeTakeFirst();
    expect(message?.direction).toBe("OUTBOUND");
    expect(message?.channel).toBe("WHATSAPP");
    expect(message?.simulated).toBe(true);
    expect(message?.body).toContain("book you a quick demo");

    const task = await db
      .selectFrom("tasks")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .executeTakeFirst();
    expect(task?.title).toBe(`Follow up with ${SALES_LEAD}`);
    expect(task?.status).toBe("OPEN");
  });

  // ---- Phase 2: automation settings, sequences, replies ----

  it("exposes sales automation settings with safe defaults", async () => {
    const res = await api.get("/api/v1/agents/sales/settings").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.autoSend).toBe(false);
    expect(res.body.data.scoreThreshold).toBe(65);
    expect(res.body.data).toHaveProperty("activeEnrollments");
  });

  it("saves sales automation settings", async () => {
    // auto_send stays OFF so nothing is delivered during the test.
    const res = await api
      .put("/api/v1/agents/sales/settings")
      .set(auth(adminToken))
      .send({ enabled: true, scoreThreshold: 90, dailyCap: 10, autoSend: false });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.scoreThreshold).toBe(90);

    const get = await api.get("/api/v1/agents/sales/settings").set(auth(adminToken));
    expect(get.body.data.enabled).toBe(true);
  });

  it("automation enrols a hot lead and drafts the first touch", async () => {
    // Pin the signal fields right before the run. Earlier outbound sends trigger
    // a background rescore that can move score_total, so re-assert them here; the
    // fresh last_activity_at also ranks this lead first among signals.
    await db
      .updateTable("leads")
      .set({ score_total: 100, score_grade: "HOT", status: "NEW", last_activity_at: new Date() })
      .where("id", "=", salesLeadId)
      .execute();

    const result = await agentsService.runSalesAutomation(new Date());
    expect(result.drafted).toBeGreaterThanOrEqual(1);

    const enrollment = await db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("agent", "=", "sales")
      .executeTakeFirstOrThrow();
    expect(enrollment.status).toBe("ACTIVE");
    // Step 0 was drafted, so the enrollment advanced to step 1.
    expect(enrollment.current_step).toBe(1);

    const draft = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("status", "=", "DRAFT")
      .orderBy("created_at", "desc")
      .executeTakeFirst();
    expect(draft?.reason).toContain("sequence touch");
  });

  it("automation does not run outside the workspace working hours", async () => {
    // Close the workspace for today. Note an EMPTY days array would be treated
    // as "unset" and fall back to Mon-Fri, so pick a real day that isn't today.
    const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const todayIst = new Intl.DateTimeFormat("en-US", {
      timeZone: ALWAYS_OPEN.timezone,
      weekday: "short",
    }).format(new Date());
    const notToday = (dowNames.indexOf(todayIst) + 1) % 7;
    await setWorkingHours({ ...ALWAYS_OPEN, days: [notToday] });
    const closedLeadId = ulid();
    const now = new Date();
    await db
      .insertInto("leads")
      .values({
        id: closedLeadId,
        tenant_id: nwTenantId,
        name: `Agent Closed Hours Lead ${ts}`,
        email: "agent.closed@example.com",
        phone: "+919000000004",
        status: "NEW",
        tags: JSON.stringify([]),
        notes: "",
        score_total: 100,
        score_grade: "HOT",
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();

    // Asserted per-lead: runSalesAutomation spans every opted-in tenant, so the
    // global counters aren't a safe assertion target.
    await agentsService.runSalesAutomation(new Date());

    const enrollment = await db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("lead_id", "=", closedLeadId)
      .executeTakeFirst();
    expect(enrollment).toBeUndefined();

    await db.deleteFrom("leads").where("id", "=", closedLeadId).execute();
    await setWorkingHours(ALWAYS_OPEN);
  });

  it("an inbound reply pauses the sequence and drafts a response", async () => {
    await agentsService.handleInboundReply(
      nwTenantId,
      salesLeadId,
      "Yes, I'm interested, what are the batch timings?"
    );

    const enrollment = await db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("agent", "=", "sales")
      .executeTakeFirstOrThrow();
    expect(enrollment.status).toBe("REPLIED");

    const reply = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("reason", "=", "Reply to inbound message")
      .executeTakeFirst();
    expect(reply?.status).toBe("DRAFT");
  });

  // ---- Phase 3: outcome tracking + feedback ----

  it("attributes the reply to the outreach that earned it", async () => {
    // The approved Phase 1 send is the most recent SENT outreach for this lead,
    // so the inbound reply above should have stamped it.
    const sent = await db
      .selectFrom("agent_outreach")
      .selectAll()
      .where("lead_id", "=", salesLeadId)
      .where("status", "=", "SENT")
      .orderBy("sent_at", "desc")
      .executeTakeFirstOrThrow();
    expect(sent.replied_at).toBeTruthy();
  });

  it("reports sales effectiveness metrics", async () => {
    const res = await api.get("/api/v1/agents/sales/metrics?days=30").set(auth(adminToken));
    expect(res.status).toBe(200);
    const m = res.body.data;
    expect(m.windowDays).toBe(30);
    expect(m.drafted).toBeGreaterThanOrEqual(1);
    expect(m.sent).toBeGreaterThanOrEqual(1);
    expect(m.replied).toBeGreaterThanOrEqual(1);
    // Reply rate is a whole percentage derived from sent vs replied.
    expect(m.replyRate).toBeGreaterThan(0);
    expect(m).toHaveProperty("meetings");
  });

  it("never re-enrols a lead whose draft a human rejected", async () => {
    // Fresh lead that qualifies as a signal, with a rejected draft on file.
    const rejectedLeadId = ulid();
    const now = new Date();
    await db
      .insertInto("leads")
      .values({
        id: rejectedLeadId,
        tenant_id: nwTenantId,
        name: `Agent Rejected Lead ${ts}`,
        email: "agent.rejected@example.com",
        phone: "+919000000003",
        status: "NEW",
        tags: JSON.stringify([]),
        notes: "",
        score_total: 100,
        score_grade: "HOT",
        last_activity_at: now,
        created_at: now,
        updated_at: now,
      })
      .execute();
    await db
      .insertInto("agent_outreach")
      .values({
        id: ulid(),
        tenant_id: nwTenantId,
        agent: "sales",
        lead_id: rejectedLeadId,
        channel: "WHATSAPP",
        status: "REJECTED",
        body: "rejected draft",
        created_at: now,
        updated_at: now,
      })
      .execute();

    await agentsService.runSalesAutomation(new Date());

    const enrollment = await db
      .selectFrom("agent_enrollments")
      .selectAll()
      .where("lead_id", "=", rejectedLeadId)
      .executeTakeFirst();
    expect(enrollment).toBeUndefined();

    await db.deleteFrom("agent_outreach").where("lead_id", "=", rejectedLeadId).execute();
    await db.deleteFrom("leads").where("id", "=", rejectedLeadId).execute();
  });

  it("support agent resolves an open ticket from the knowledge base", async () => {
    const res = await api.post("/api/v1/agents/support/run?limit=1").set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.summary).toBe("Auto-resolved 1/1 tickets");
    expect(data.actions).toContain(`Resolved: ${TICKET_SUBJECT}`);

    const ticket = await db
      .selectFrom("tickets")
      .selectAll()
      .where("id", "=", ticketId)
      .executeTakeFirstOrThrow();
    expect(ticket.status).toBe("RESOLVED");
    expect(ticket.resolved_by).toBe("ai");
    expect(ticket.resolved_at).toBeTruthy();

    const reply = await db
      .selectFrom("ticket_replies")
      .selectAll()
      .where("ticket_id", "=", ticketId)
      .executeTakeFirst();
    expect(reply?.is_ai).toBe(true);
    expect(reply?.body).toBeTruthy();
  });

  it("collections agent emails the invoice contact a real reminder", async () => {
    const res = await api.post("/api/v1/agents/collections/run?limit=1").set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.summary).toContain("Chased 1 overdue invoices");
    expect(data.actions[0]).toContain(INVOICE_NUMBER);

    // The contact has an email but no phone, so it falls back to the email
    // channel (collections prefers email anyway for invoice reminders).
    const message = await db
      .selectFrom("messages")
      .selectAll()
      .where("contact_id", "=", collContactId)
      .executeTakeFirst();
    expect(message?.channel).toBe("EMAIL");
    expect(message?.body).toContain(INVOICE_NUMBER);
    expect(message?.body).toContain("pending");
  });

  it("marketing agent sends the followup template to a tagged audience", async () => {
    const res = await api
      .post("/api/v1/agents/marketing/run")
      .set(auth(adminToken))
      .send({ audienceTag: MKT_TAG });
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.audience).toBe(1);
    expect(data.summary).toContain(MKT_TAG);
    expect(data.actions.some((a: string) => a.includes(MKT_LEAD))).toBe(true);

    // The lead has a phone, so it delivers over WhatsApp using the approved
    // "followup" template; the recorded body is the resolved template text.
    const message = await db
      .selectFrom("messages")
      .selectAll()
      .where("lead_id", "=", mktLeadId)
      .executeTakeFirst();
    expect(message?.channel).toBe("WHATSAPP");
    expect(message?.body?.toLowerCase()).toContain("following up");
  });

  it("knowledge agent answers from the knowledge base", async () => {
    const res = await api
      .post("/api/v1/agents/knowledge/run")
      .set(auth(adminToken))
      .send({ query: "refund duplicate payment" });
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.actions).toContain("Refund policy");
    expect(data.results.length).toBeGreaterThanOrEqual(1);
    expect(data.results[0].snippet).toBeTruthy();
  });

  it("coach agent advises on the highest-value open deal", async () => {
    const res = await api.post("/api/v1/agents/coach/run").set(auth(adminToken));
    expect(res.status).toBe(200);
    const data = res.body.data;
    runIds.push(data.run.id);
    expect(data.summary).toContain("Coached on");
    expect(data.actions).toHaveLength(1);
    expect(data.strategy).toBeTruthy();
    expect(data.talkingPoints).toHaveLength(3);
    expect(data.objectionHandling.length).toBeGreaterThanOrEqual(4);
    expect(data.deal).toBeTruthy();
  });

  it("aggregates run counts after runs", async () => {
    const res = await api.get("/api/v1/agents").set(auth(adminToken));
    const sales = res.body.data.find((a: { key: string }) => a.key === "sales");
    expect(sales.runCount).toBeGreaterThanOrEqual(1);
    expect(sales.lastRunAt).toBeTruthy();
    expect(new Date(sales.lastRunAt).getTime()).toBeGreaterThanOrEqual(testStart.getTime() - 1000);
  });

  it("lists runs latest-first with parsed actions", async () => {
    const res = await api.get("/api/v1/agents/runs").set(auth(adminToken));
    expect(res.status).toBe(200);
    const runs = res.body.data;
    expect(runs.length).toBeLessThanOrEqual(100);
    for (const id of runIds) {
      expect(runs.some((r: { id: string }) => r.id === id)).toBe(true);
    }
    const mine = runs.find((r: { id: string }) => r.id === runIds[0]);
    expect(Array.isArray(mine.actions)).toBe(true);
    const first = new Date(runs[0].created_at).getTime();
    const last = new Date(runs[runs.length - 1].created_at).getTime();
    expect(first).toBeGreaterThanOrEqual(last);
  });

  it("never shows another tenant's runs", async () => {
    // The Growth tenant is not entitled to agents; grant it for this check so
    // the request reaches the query instead of stopping at the entitlement gate.
    const acme = await db
      .selectFrom("tenants")
      .select(["id"])
      .where("slug", "=", "acme")
      .executeTakeFirstOrThrow();
    const grantId = ulid();
    const now = new Date();
    await db
      .insertInto("tenant_entitlements")
      .values({ id: grantId, tenant_id: acme.id, code: "module.agents", enabled: true, source: "ADMIN", created_at: now, updated_at: now })
      .execute();
    entitlementsService.invalidate(acme.id);
    try {
      const res = await api.get("/api/v1/agents/runs").set(auth(esAdminToken));
      expect(res.status).toBe(200);
      expect(res.body.data.some((r: { id: string }) => runIds.includes(r.id))).toBe(false);
    } finally {
      await db.deleteFrom("tenant_entitlements").where("id", "=", grantId).execute();
      entitlementsService.invalidate(acme.id);
    }
  });
});
