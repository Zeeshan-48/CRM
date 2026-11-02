/**
 * Copilot tools, the read-only, tenant-scoped query layer the agentic copilot
 * plans against. The LLM chooses WHICH tool and WHAT arguments; it never writes
 * SQL. Every executor here:
 *   - is read-only (SELECT only),
 *   - injects `tenant_id` from the server (never from model input),
 *   - validates + coerces every argument against a whitelist,
 *   - caps rows/groups so a plan can never pull unbounded data.
 * This is the safety boundary: the model's output only ever picks from a fixed
 * menu of parameterized queries.
 */
import { sql } from "kysely";
import { db } from "../../db/connection";

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  count?: number; // total matching rows (may exceed the returned, capped rows)
  note?: string; // e.g. an argument-validation message or an execution error
}

const ROW_DEFAULT = 25;
const ROW_MAX = 50;
const GROUP_MAX = 50;
const MAX_TOOL_CALLS = 4;

// ---------- argument coercion (all input is untrusted model output) ----------

const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

const asNum = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const asBool = (v: unknown): boolean =>
  v === true || v === "true" || v === 1 || v === "1";

const asEnum = <T extends string>(v: unknown, allowed: readonly T[]): T | null => {
  const s = asStr(v);
  if (!s) return null;
  const up = s.toUpperCase();
  return (allowed as readonly string[]).includes(up) ? (up as T) : null;
};

const clampLimit = (v: unknown): number => {
  const n = asNum(v);
  if (n === null) return ROW_DEFAULT;
  return Math.max(1, Math.min(ROW_MAX, Math.round(n)));
};

const cutoff = (days: number): Date => new Date(Date.now() - days * 86_400_000);

const LEAD_STATUS = [
  "NEW",
  "ATTEMPTED",
  "CONNECTED",
  "QUALIFIED",
  "NURTURE",
  "NOT_INTERESTED",
  "DISQUALIFIED",
  "CONVERTED",
] as const;
const LEAD_GRADE = ["HOT", "WARM", "COLD"] as const;
const DEAL_STATUS = ["OPEN", "WON", "LOST"] as const;
const TICKET_STATUS = ["OPEN", "PENDING", "RESOLVED", "CLOSED"] as const;
const TICKET_PRIORITY = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const CONTACT_LIFECYCLE = ["LEAD", "PROSPECT", "CUSTOMER"] as const;

const str = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "-" : String(v);

// ---------- individual tools ----------

async function queryLeads(tenantId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const city = asStr(args.city);
  const grade = asEnum(args.grade, LEAD_GRADE);
  const source = asStr(args.source);
  const status = asEnum(args.status, LEAD_STATUS);
  const minScore = asNum(args.minScore);
  const createdWithinDays = asNum(args.createdWithinDays);
  const hasDemo = asBool(args.hasDemo);
  const notPurchased = asBool(args.notPurchased);
  const limit = clampLimit(args.limit);

  let base = db.selectFrom("leads").where("tenant_id", "=", tenantId);
  if (city) base = base.where("city", "ilike", `%${city}%`);
  if (grade) base = base.where("score_grade", "=", grade);
  if (source) base = base.where("source", "ilike", `%${source}%`);
  if (status) base = base.where("status", "=", status);
  if (minScore !== null) base = base.where("score_total", ">=", Math.round(minScore));
  if (createdWithinDays !== null)
    base = base.where("created_at", ">=", cutoff(createdWithinDays));
  if (notPurchased) base = base.where("converted_deal_id", "is", null);
  if (hasDemo) {
    base = base.where((eb) =>
      eb.exists(
        eb
          .selectFrom("activities")
          .select("activities.id")
          .whereRef("activities.lead_id", "=", "leads.id")
          .where("activities.tenant_id", "=", tenantId)
          .where("activities.type", "=", "DEMO")
      )
    );
  }

  const rows = await base
    .select(["name", "city", "source", "score_total", "score_grade", "status"])
    .orderBy("score_total", "desc")
    .limit(limit)
    .execute();
  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .executeTakeFirst();

  return {
    tool: "queryLeads",
    columns: ["Name", "City", "Source", "Score", "Grade", "Status"],
    rows: rows.map((r) => [
      str(r.name),
      str(r.city),
      str(r.source),
      r.score_total,
      str(r.score_grade),
      str(r.status),
    ]),
    count: Number(counted?.c ?? rows.length),
  };
}

async function queryDeals(tenantId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const status = asEnum(args.status, DEAL_STATUS);
  const stage = asStr(args.stage);
  const minValue = asNum(args.minValue);
  const maxValue = asNum(args.maxValue);
  const minWinPct = asNum(args.minWinPct);
  const createdWithinDays = asNum(args.createdWithinDays);
  const staleDays = asNum(args.staleDays);
  const sortBy = asEnum(args.sortBy, ["VALUE", "WINPCT", "CREATED"] as const) ?? "VALUE";
  const limit = clampLimit(args.limit);

  let base = db
    .selectFrom("deals")
    .leftJoin("stages", "stages.id", "deals.stage_id")
    .where("deals.tenant_id", "=", tenantId);
  if (status) base = base.where("deals.status", "=", status);
  if (stage) base = base.where("stages.name", "ilike", `%${stage}%`);
  if (minValue !== null) base = base.where("deals.value", ">=", Math.round(minValue));
  if (maxValue !== null) base = base.where("deals.value", "<=", Math.round(maxValue));
  if (minWinPct !== null) base = base.where("deals.win_probability", ">=", Math.round(minWinPct));
  if (createdWithinDays !== null)
    base = base.where("deals.created_at", ">=", cutoff(createdWithinDays));
  if (staleDays !== null) {
    const staleCut = cutoff(staleDays);
    base = base.where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom("activities")
            .select("activities.id")
            .whereRef("activities.deal_id", "=", "deals.id")
            .where("activities.tenant_id", "=", tenantId)
            .where("activities.created_at", ">=", staleCut)
        )
      )
    );
  }

  const orderCol =
    sortBy === "WINPCT" ? "deals.win_probability" : sortBy === "CREATED" ? "deals.created_at" : "deals.value";
  const rows = await base
    .select([
      "deals.title as title",
      "deals.value as value",
      "deals.status as status",
      "deals.win_probability as win",
      "stages.name as stage",
    ])
    .orderBy(orderCol, "desc")
    .limit(limit)
    .execute();
  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .executeTakeFirst();

  return {
    tool: "queryDeals",
    columns: ["Deal", "Value", "Status", "Win %", "Stage"],
    rows: rows.map((r) => [str(r.title), r.value, str(r.status), `${r.win}%`, str(r.stage)]),
    count: Number(counted?.c ?? rows.length),
  };
}

async function queryTickets(tenantId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const status = asEnum(args.status, TICKET_STATUS);
  const priority = asEnum(args.priority, TICKET_PRIORITY);
  const overdue = asBool(args.overdue);
  const limit = clampLimit(args.limit);
  const now = new Date();

  let base = db.selectFrom("tickets").where("tenant_id", "=", tenantId);
  if (status) base = base.where("status", "=", status);
  else base = base.where("status", "!=", "CLOSED");
  if (priority) base = base.where("priority", "=", priority);
  if (overdue) base = base.where("sla_due_at", "<", now).where("status", "!=", "CLOSED");

  const rows = await base
    .select(["subject", "priority", "status", "sla_due_at"])
    .orderBy("sla_due_at", "asc")
    .limit(limit)
    .execute();
  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .executeTakeFirst();

  return {
    tool: "queryTickets",
    columns: ["Subject", "Priority", "Status", "SLA"],
    rows: rows.map((r) => [
      str(r.subject),
      str(r.priority),
      str(r.status),
      r.sla_due_at ? (new Date(r.sla_due_at).getTime() < now.getTime() ? "Breached" : "On track") : "-",
    ]),
    count: Number(counted?.c ?? rows.length),
  };
}

async function queryContacts(tenantId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const company = asStr(args.company);
  const city = asStr(args.city);
  const inactiveDays = asNum(args.inactiveDays);
  const lifecycle = asEnum(args.lifecycle, CONTACT_LIFECYCLE);
  const limit = clampLimit(args.limit);

  let base = db.selectFrom("contacts").where("tenant_id", "=", tenantId);
  if (company) base = base.where("company", "ilike", `%${company}%`);
  if (city) base = base.where("city", "ilike", `%${city}%`);
  if (lifecycle) base = base.where("lifecycle", "=", lifecycle);
  if (inactiveDays !== null) {
    const cut = cutoff(inactiveDays);
    base = base.where((eb) =>
      eb.or([
        eb("last_activity_at", "<", cut),
        eb.and([eb("last_activity_at", "is", null), eb("created_at", "<", cut)]),
      ])
    );
  }

  const rows = await base
    .select(["name", "company", "city", "email", "last_activity_at", "created_at"])
    .orderBy("last_activity_at", "asc")
    .limit(limit)
    .execute();
  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .executeTakeFirst();

  const now = Date.now();
  return {
    tool: "queryContacts",
    columns: ["Name", "Company", "City", "Email", "Inactive days"],
    rows: rows.map((r) => {
      const last = r.last_activity_at ?? r.created_at;
      const days = Math.round((now - new Date(last).getTime()) / 86_400_000);
      return [str(r.name), str(r.company), str(r.city), str(r.email), days];
    }),
    count: Number(counted?.c ?? rows.length),
  };
}

async function agentPerformance(
  tenantId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const limit = clampLimit(args.limit);
  const users = await db
    .selectFrom("users")
    .select(["id", "name", "role"])
    .where("tenant_id", "=", tenantId)
    .where("role", "in", ["SALES_AGENT", "MANAGER"])
    .execute();
  if (!users.length) {
    return { tool: "agentPerformance", columns: ["Agent"], rows: [], count: 0 };
  }
  const ids = users.map((u) => u.id);

  const dealAgg = await db
    .selectFrom("deals")
    .select((eb) => [
      "owner_id",
      "status",
      eb.fn.countAll<string>().as("c"),
      eb.fn.sum<string>("value").as("val"),
    ])
    .where("tenant_id", "=", tenantId)
    .where("owner_id", "in", ids)
    .groupBy(["owner_id", "status"])
    .execute();
  const actAgg = await db
    .selectFrom("activities")
    .select((eb) => ["owner_id", eb.fn.countAll<string>().as("c")])
    .where("tenant_id", "=", tenantId)
    .where("owner_id", "in", ids)
    .groupBy("owner_id")
    .execute();

  const won = new Map<string, number>();
  const openCount = new Map<string, number>();
  const openVal = new Map<string, number>();
  for (const d of dealAgg) {
    if (!d.owner_id) continue;
    if (d.status === "WON") won.set(d.owner_id, Number(d.c));
    if (d.status === "OPEN") {
      openCount.set(d.owner_id, Number(d.c));
      openVal.set(d.owner_id, Number(d.val ?? 0));
    }
  }
  const acts = new Map<string, number>();
  for (const a of actAgg) if (a.owner_id) acts.set(a.owner_id, Number(a.c));

  const ranked = users
    .map((u) => ({
      name: u.name,
      role: u.role,
      won: won.get(u.id) ?? 0,
      open: openCount.get(u.id) ?? 0,
      pipeline: openVal.get(u.id) ?? 0,
      activities: acts.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.won * 10 + b.activities - (a.won * 10 + a.activities))
    .slice(0, limit);

  return {
    tool: "agentPerformance",
    columns: ["Agent", "Role", "Deals won", "Open deals", "Open pipeline", "Activities"],
    rows: ranked.map((r) => [r.name, r.role, r.won, r.open, r.pipeline, r.activities]),
    count: ranked.length,
  };
}

// Whitelist: entity -> allowed groupBy -> the real column reference. The value
// is always a fixed literal from THIS map (never model input), so feeding it to
// sql.ref() cannot inject.
const GROUP_COLUMNS: Record<string, Record<string, string>> = {
  leads: { source: "source", status: "status", grade: "score_grade", city: "city", owner: "owner_id" },
  deals: { status: "status", owner: "owner_id", stage: "stage_id" },
  tickets: { status: "status", priority: "priority" },
  contacts: { city: "city", lifecycle: "lifecycle", owner: "owner_id" },
};

async function aggregate(tenantId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const entity = asEnum(args.entity, ["LEADS", "DEALS", "TICKETS", "CONTACTS"] as const);
  if (!entity) return { tool: "aggregate", columns: [], rows: [], note: "unknown or missing entity" };
  const table = entity.toLowerCase() as "leads" | "deals" | "tickets" | "contacts";

  const metricName =
    asEnum(args.metric, ["COUNT", "SUM_VALUE", "AVG_VALUE", "WEIGHTED_PIPELINE"] as const) ?? "COUNT";
  if (metricName !== "COUNT" && table !== "deals") {
    return { tool: "aggregate", columns: [], rows: [], note: `metric ${metricName} is only valid for deals` };
  }
  const groupByRaw = asStr(args.groupBy)?.toLowerCase() ?? null;
  const groupCol = groupByRaw ? (GROUP_COLUMNS[table]?.[groupByRaw] ?? null) : null;
  if (groupByRaw && !groupCol) {
    return {
      tool: "aggregate",
      columns: [],
      rows: [],
      note: `cannot group ${table} by ${groupByRaw}; allowed: ${Object.keys(GROUP_COLUMNS[table] ?? {}).join(", ")}`,
    };
  }

  const createdWithinDays = asNum(args.createdWithinDays);
  const status = asStr(args.status)?.toUpperCase() ?? null;
  const minValue = asNum(args.minValue);
  const maxValue = asNum(args.maxValue);

  // Metric expression (fixed literals only).
  const metricExpr =
    metricName === "SUM_VALUE"
      ? sql<string>`coalesce(sum(value), 0)`
      : metricName === "AVG_VALUE"
        ? sql<string>`coalesce(round(avg(value)), 0)`
        : metricName === "WEIGHTED_PIPELINE"
          ? sql<string>`coalesce(round(sum(value * win_probability / 100.0)), 0)`
          : sql<string>`count(*)`;

  // `table` is a runtime-chosen union, so per-table column typing can't hold, // the values stay trusted (fixed enum literals + server-injected tenantId).
  let q: any = db.selectFrom(table).where("tenant_id", "=", tenantId);
  if (createdWithinDays !== null) q = q.where("created_at", ">=", cutoff(createdWithinDays));
  if (status) q = q.where("status", "=", status);
  if (table === "deals") {
    if (minValue !== null) q = q.where("value", ">=", Math.round(minValue));
    if (maxValue !== null) q = q.where("value", "<=", Math.round(maxValue));
    // Weighted pipeline is only meaningful on open deals, scope it unless the
    // caller explicitly asked for a status.
    if (metricName === "WEIGHTED_PIPELINE" && !status) q = q.where("status", "=", "OPEN");
  }

  const label = metricLabel(metricName);
  if (!groupCol) {
    const one = await q.select(metricExpr.as("m")).executeTakeFirst();
    return {
      tool: "aggregate",
      columns: [label],
      rows: [[Number(one?.m ?? 0)]],
    };
  }

  const ref = sql.ref(groupCol);
  const grouped = await q
    .select([ref.as("g"), metricExpr.as("m")])
    .groupBy(ref)
    .orderBy("m", "desc")
    .limit(GROUP_MAX)
    .execute();

  // Map owner_id / stage_id group keys to human names.
  let nameOf: (v: unknown) => string = (v) => str(v as string);
  if (groupCol === "owner_id") {
    const map = await nameMap("users", tenantId);
    nameOf = (v) => (v ? map.get(String(v)) ?? "-" : "Unassigned");
  } else if (groupCol === "stage_id") {
    const map = await nameMap("stages", tenantId);
    nameOf = (v) => (v ? map.get(String(v)) ?? "-" : "-");
  }

  const groupLabel = groupByRaw ? groupByRaw[0].toUpperCase() + groupByRaw.slice(1) : "Group";
  return {
    tool: "aggregate",
    columns: [groupLabel, label],
    rows: (grouped as Array<{ g: unknown; m: string }>).map((r) => [nameOf(r.g), Number(r.m)]),
    count: grouped.length,
  };
}

const metricLabel = (m: string): string =>
  m === "SUM_VALUE"
    ? "Total value"
    : m === "AVG_VALUE"
      ? "Avg value"
      : m === "WEIGHTED_PIPELINE"
        ? "Weighted pipeline"
        : "Count";

const nameMap = async (table: "users" | "stages", tenantId: string): Promise<Map<string, string>> => {
  const rows = await db
    .selectFrom(table)
    .select(["id", "name"])
    .where("tenant_id", "=", tenantId)
    .execute();
  return new Map(rows.map((r) => [r.id, r.name]));
};

// ---------- product integration ----------

const INTENT_BAND = ["HOT", "WARM", "COLD"] as const;
const LIFECYCLE_STAGE = [
  "VISITOR",
  "SIGNED_UP",
  "TRIAL",
  "ACTIVE",
  "PAYING",
  "CHURNED",
] as const;

/**
 * People showing intent inside a connected product. This is what makes "who
 * should I call today" and "why is this lead hot" answerable, because it reads
 * the stored rollup rather than asking the model to reason over raw events.
 */
async function queryProductIntent(
  tenantId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const band = asEnum(args.band, INTENT_BAND);
  const stage = asEnum(args.stage, LIFECYCLE_STAGE);
  const minScore = asNum(args.minScore);
  const abandonedOnly = asBool(args.abandonedCheckout);
  const activeWithinDays = asNum(args.activeWithinDays);
  const limit = clampLimit(args.limit);

  let base = db
    .selectFrom("engagement_profiles")
    .innerJoin("connected_apps", "connected_apps.id", "engagement_profiles.app_id")
    .leftJoin("leads", "leads.id", "engagement_profiles.lead_id")
    .leftJoin("contacts", "contacts.id", "engagement_profiles.contact_id")
    .where("engagement_profiles.tenant_id", "=", tenantId);

  if (band) base = base.where("engagement_profiles.intent_band", "=", band);
  if (stage) base = base.where("engagement_profiles.lifecycle_stage", "=", stage);
  if (minScore !== null) {
    base = base.where("engagement_profiles.intent_score", ">=", Math.round(minScore));
  }
  if (abandonedOnly) base = base.where("engagement_profiles.checkout_abandoned_at", "is not", null);
  if (activeWithinDays !== null) {
    base = base.where("engagement_profiles.last_seen_at", ">=", cutoff(activeWithinDays));
  }

  const rows = await base
    .select([
      sql<string>`COALESCE("contacts"."name", "leads"."name")`.as("person"),
      "connected_apps.name as product",
      "engagement_profiles.lifecycle_stage as stage",
      "engagement_profiles.plan_name as plan",
      "engagement_profiles.intent_score as score",
      "engagement_profiles.intent_band as band",
      "engagement_profiles.last_seen_at as last_seen",
    ])
    .orderBy("engagement_profiles.intent_score", "desc")
    .limit(limit)
    .execute();

  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirst();

  return {
    tool: "queryProductIntent",
    columns: ["person", "product", "stage", "plan", "score", "band", "last_seen"],
    rows: rows.map((r) => [
      str(r.person),
      str(r.product),
      str(r.stage),
      str(r.plan),
      r.score,
      str(r.band),
      r.last_seen ? new Date(r.last_seen).toISOString().slice(0, 10) : "-",
    ]),
    count: typeof counted?.count === "string" ? parseInt(counted.count, 10) : 0,
  };
}

/** The catalog an agent pitches from, with the live default price. */
async function queryProductCatalog(
  tenantId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const category = asStr(args.category);
  const search = asStr(args.search);
  const limit = clampLimit(args.limit);

  let base = db
    .selectFrom("products")
    .leftJoin("product_prices", (join) =>
      join
        .onRef("product_prices.product_id", "=", "products.id")
        .on("product_prices.is_default", "=", true)
    )
    .where("products.tenant_id", "=", tenantId)
    .where("products.status", "=", "ACTIVE");

  if (category) base = base.where("products.category", "ilike", `%${category}%`);
  if (search) {
    base = base.where((eb) =>
      eb.or([
        eb("products.name", "ilike", `%${search}%`),
        eb("products.description", "ilike", `%${search}%`),
      ])
    );
  }

  const rows = await base
    .select([
      "products.name as name",
      "products.category as category",
      "product_prices.currency as currency",
      "product_prices.amount_minor as amount_minor",
      "products.total_sales as sales",
    ])
    .orderBy("products.sort_order", "asc")
    .orderBy("products.name", "asc")
    .limit(limit)
    .execute();

  const counted = await base
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .executeTakeFirst();

  return {
    tool: "queryProductCatalog",
    columns: ["name", "category", "price", "sales"],
    rows: rows.map((r) => [
      str(r.name),
      str(r.category),
      // Minor units are an implementation detail; the model should see money.
      r.amount_minor === null
        ? "-"
        : `${str(r.currency) === "-" ? "INR" : str(r.currency)} ${(r.amount_minor / 100).toFixed(2)}`,
      r.sales,
    ]),
    count: typeof counted?.count === "string" ? parseInt(counted.count, 10) : 0,
  };
}

/** Live offers and coupons an agent can quote right now. */
async function queryOffers(
  tenantId: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const limit = clampLimit(args.limit);
  const now = new Date();

  const base = db
    .selectFrom("product_offers")
    .leftJoin("products", "products.id", "product_offers.product_id")
    .where("product_offers.tenant_id", "=", tenantId)
    .where("product_offers.status", "!=", "DISABLED")
    // The window is the truth, not the stored status: an ACTIVE row with a past
    // end date must never be quoted to a customer.
    .where((eb) =>
      eb.and([
        eb.or([
          eb("product_offers.starts_at", "is", null),
          eb("product_offers.starts_at", "<=", now),
        ]),
        eb.or([eb("product_offers.ends_at", "is", null), eb("product_offers.ends_at", ">=", now)]),
      ])
    );

  const rows = await base
    .select([
      "product_offers.name as name",
      "product_offers.code as code",
      "product_offers.discount_type as discount_type",
      "product_offers.discount_value as discount_value",
      "product_offers.ends_at as ends_at",
      "products.name as product",
    ])
    .orderBy("product_offers.ends_at", "asc")
    .limit(limit)
    .execute();

  return {
    tool: "queryOffers",
    columns: ["name", "code", "discount", "applies_to", "ends"],
    rows: rows.map((r) => [
      str(r.name),
      str(r.code),
      r.discount_type === "PERCENT"
        ? `${r.discount_value}%`
        : `flat ${(r.discount_value / 100).toFixed(2)}`,
      str(r.product) === "-" ? "all products" : str(r.product),
      r.ends_at ? new Date(r.ends_at).toISOString().slice(0, 10) : "no end date",
    ]),
    count: rows.length,
  };
}

// ---------- registry + catalog ----------

type ToolFn = (tenantId: string, args: Record<string, unknown>) => Promise<ToolResult>;

const TOOLS: Record<string, ToolFn> = {
  queryLeads,
  queryDeals,
  queryTickets,
  queryContacts,
  agentPerformance,
  aggregate,
  queryProductIntent,
  queryProductCatalog,
  queryOffers,
};

export const TOOL_NAMES = new Set(Object.keys(TOOLS));

// The menu shown to the planner model. Kept terse but complete: names, what
// each returns, and the allowed arguments/values so it emits valid plans.
export const TOOL_CATALOG = `AVAILABLE TOOLS (call by name with JSON args):

1. queryLeads, list leads matching filters, ranked by score.
   args: city?(string), grade?("HOT"|"WARM"|"COLD"), source?(string),
   status?("NEW"|"ATTEMPTED"|"CONNECTED"|"QUALIFIED"|"NURTURE"|"NOT_INTERESTED"|"DISQUALIFIED"|"CONVERTED"), minScore?(0-100),
   createdWithinDays?(number), hasDemo?(bool), notPurchased?(bool), limit?(<=50)

2. queryDeals, list deals matching filters.
   args: status?("OPEN"|"WON"|"LOST"), stage?(stage name), minValue?(number),
   maxValue?(number), minWinPct?(0-100), createdWithinDays?(number),
   staleDays?(number = no activity in N days), sortBy?("value"|"winPct"|"created"), limit?(<=50)

3. queryTickets, list support tickets (defaults to not-closed).
   args: status?("OPEN"|"PENDING"|"RESOLVED"|"CLOSED"),
   priority?("URGENT"|"HIGH"|"MEDIUM"|"LOW"), overdue?(bool), limit?(<=50)

4. queryContacts, list contacts, oldest-touch first.
   args: company?(string), city?(string), inactiveDays?(number),
   lifecycle?("LEAD"|"PROSPECT"|"CUSTOMER"), limit?(<=50)

5. agentPerformance, per-agent deals won, open deals, open pipeline, activities.
   args: limit?(<=50)

6. aggregate, counts / sums / averages, optionally grouped. THE tool for
   "how many", "compare", "by source/stage/owner", "total pipeline".
   args: entity("leads"|"deals"|"tickets"|"contacts"),
   metric?("count"|"sum_value"|"avg_value"|"weighted_pipeline"; the value ones are deals-only),
   groupBy?(leads:"source"|"status"|"grade"|"city"|"owner"; deals:"status"|"stage"|"owner";
   tickets:"status"|"priority"; contacts:"city"|"lifecycle"|"owner"),
   status?(string), createdWithinDays?(number), minValue?(number), maxValue?(number)

7. queryProductIntent, people showing intent INSIDE a connected product, hottest
   first. THE tool for "who should I call today", "who is about to buy",
   "who abandoned checkout", "why is this lead hot".
   args: band?("HOT"|"WARM"|"COLD"),
   stage?("VISITOR"|"SIGNED_UP"|"TRIAL"|"ACTIVE"|"PAYING"|"CHURNED"),
   minScore?(0-100), abandonedCheckout?(bool), activeWithinDays?(number), limit?(<=50)

8. queryProductCatalog, what the connected products sell, with the live price.
   THE tool for "what can I pitch", "what does X cost".
   args: category?(string), search?(string), limit?(<=50)

9. queryOffers, offers and coupon codes that are LIVE right now (expired ones
   are never returned). THE tool for "what discount can I offer".
   args: limit?(<=50)`;

/**
 * Runs a validated tool plan. Unknown tools and per-tool failures degrade to a
 * note (never throw) so one bad call can't sink the whole answer. Caps the plan
 * length as a final backstop.
 */
export async function executeToolPlan(
  tenantId: string,
  calls: ToolCall[]
): Promise<ToolResult[]> {
  const capped = calls.slice(0, MAX_TOOL_CALLS);
  const results = await Promise.all(
    capped.map(async (call): Promise<ToolResult> => {
      const fn = TOOLS[call.name];
      if (!fn) {
        return { tool: call.name, columns: [], rows: [], note: "unknown tool" };
      }
      try {
        return await fn(tenantId, call.args ?? {});
      } catch (err) {
        return {
          tool: call.name,
          columns: [],
          rows: [],
          note: `tool error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    })
  );
  return results;
}
