import { sql } from "kysely";
import { db } from "../db/connection";

export interface DealTotals {
  total: number;
  won: number;
  lost: number;
  open: number;
  wonRevenue: number;
  weightedOpenPipeline: number;
  // Raw (unweighted) value of all OPEN deals. Used to derive forecast
  // confidence = weighted / raw (the value-weighted average win probability).
  openPipelineValue: number;
}

export interface OwnerSalesRow {
  name: string;
  won: number;
  revenue: number;
  open: number;
}

export interface CampaignTotals {
  cost: number;
  revenue: number;
  leadsGenerated: number;
}

export interface TicketTotals {
  total: number;
  open: number;
  resolved: number;
  breached: number;
}

export interface CustomerRow {
  id: string;
  name: string;
  company: string | null;
  created_at: Date;
}

class AnalyticsRepository {
  async countLeads(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("leads")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async countContacts(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("contacts")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async countConversations(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("conversations")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async countHotLeads(tenantId: string, minScore: number): Promise<number> {
    const row = await db
      .selectFrom("leads")
      .select(db.fn.count<number>("id").as("n"))
      .where("tenant_id", "=", tenantId)
      .where("score_total", ">=", minScore)
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  // Weighted pipeline uses the stored deal win_probability snapshot.
  async dealTotals(tenantId: string): Promise<DealTotals> {
    const row = await db
      .selectFrom("deals")
      .select([
        sql<string>`count(*)`.as("total"),
        sql<string>`count(*) filter (where status = 'WON')`.as("won"),
        sql<string>`count(*) filter (where status = 'LOST')`.as("lost"),
        sql<string>`count(*) filter (where status = 'OPEN')`.as("open"),
        sql<string>`coalesce(sum(value) filter (where status = 'WON'), 0)`.as("won_revenue"),
        sql<string>`coalesce(sum(value * win_probability / 100.0) filter (where status = 'OPEN'), 0)`.as(
          "weighted"
        ),
        sql<string>`coalesce(sum(value) filter (where status = 'OPEN'), 0)`.as("open_value"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return {
      total: Number(row?.total ?? 0),
      won: Number(row?.won ?? 0),
      lost: Number(row?.lost ?? 0),
      open: Number(row?.open ?? 0),
      wonRevenue: Number(row?.won_revenue ?? 0),
      weightedOpenPipeline: Number(row?.weighted ?? 0),
      openPipelineValue: Number(row?.open_value ?? 0),
    };
  }

  // Upsell candidates: existing paying customers (a contact with a WON deal)
  // that have NO currently OPEN deal, i.e. ripe for a new opportunity.
  async upsellCandidates(tenantId: string): Promise<number> {
    const row = await db
      .selectFrom("contacts")
      .select(db.fn.count<number>("contacts.id").as("n"))
      .where("contacts.tenant_id", "=", tenantId)
      .where("contacts.lifecycle", "=", "CUSTOMER")
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("deals")
            .select("deals.id")
            .whereRef("deals.contact_id", "=", "contacts.id")
            .where("deals.tenant_id", "=", tenantId)
            .where("deals.status", "=", "WON")
        )
      )
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom("deals")
              .select("deals.id")
              .whereRef("deals.contact_id", "=", "contacts.id")
              .where("deals.tenant_id", "=", tenantId)
              .where("deals.status", "=", "OPEN")
          )
        )
      )
      .executeTakeFirst();
    return Number(row?.n ?? 0);
  }

  async salesByOwner(tenantId: string): Promise<OwnerSalesRow[]> {
    const rows = await db
      .selectFrom("users")
      .leftJoin("deals", (join) =>
        join
          .onRef("deals.owner_id", "=", "users.id")
          .onRef("deals.tenant_id", "=", "users.tenant_id")
      )
      .select([
        "users.name",
        sql<string>`count(deals.id) filter (where deals.status = 'WON')`.as("won"),
        sql<string>`coalesce(sum(deals.value) filter (where deals.status = 'WON'), 0)`.as(
          "revenue"
        ),
        sql<string>`count(deals.id) filter (where deals.status = 'OPEN')`.as("open"),
      ])
      .where("users.tenant_id", "=", tenantId)
      .where("users.role", "in", ["SALES_AGENT", "MANAGER"])
      .groupBy(["users.id", "users.name", "users.created_at"])
      .orderBy("users.created_at", "asc")
      .execute();
    return rows.map((r) => ({
      name: r.name,
      won: Number(r.won ?? 0),
      revenue: Number(r.revenue ?? 0),
      open: Number(r.open ?? 0),
    }));
  }

  async campaignTotals(tenantId: string): Promise<CampaignTotals> {
    const row = await db
      .selectFrom("campaigns")
      .select([
        sql<string>`coalesce(sum(cost), 0)`.as("cost"),
        sql<string>`coalesce(sum(revenue), 0)`.as("revenue"),
        sql<string>`coalesce(sum(leads_generated), 0)`.as("leads_generated"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return {
      cost: Number(row?.cost ?? 0),
      revenue: Number(row?.revenue ?? 0),
      leadsGenerated: Number(row?.leads_generated ?? 0),
    };
  }

  async leadsBySource(tenantId: string): Promise<Array<{ source: string; count: number }>> {
    const rows = await db
      .selectFrom("leads")
      .select(["source", db.fn.count<number>("id").as("n")])
      .where("tenant_id", "=", tenantId)
      .groupBy("source")
      .orderBy("n", "desc")
      .execute();
    return rows.map((r) => ({ source: r.source ?? "Unknown", count: Number(r.n) }));
  }

  async ticketTotals(tenantId: string): Promise<TicketTotals> {
    const row = await db
      .selectFrom("tickets")
      .select([
        sql<string>`count(*)`.as("total"),
        sql<string>`count(*) filter (where status not in ('RESOLVED', 'CLOSED'))`.as("open"),
        sql<string>`count(*) filter (where status = 'RESOLVED')`.as("resolved"),
        sql<string>`count(*) filter (where status not in ('RESOLVED', 'CLOSED') and sla_due_at is not null and sla_due_at < (now() at time zone 'utc'))`.as(
          "breached"
        ),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return {
      total: Number(row?.total ?? 0),
      open: Number(row?.open ?? 0),
      resolved: Number(row?.resolved ?? 0),
      breached: Number(row?.breached ?? 0),
    };
  }

  async customers(tenantId: string): Promise<CustomerRow[]> {
    return db
      .selectFrom("contacts")
      .select(["id", "name", "company", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("lifecycle", "=", "CUSTOMER")
      .orderBy("created_at", "asc")
      .execute();
  }

  async lastActivityByContact(tenantId: string): Promise<Map<string, Date>> {
    const rows = await db
      .selectFrom("activities")
      .select(["contact_id", sql<Date>`max(created_at)`.as("last")])
      .where("tenant_id", "=", tenantId)
      .where("contact_id", "is not", null)
      .groupBy("contact_id")
      .execute();
    const map = new Map<string, Date>();
    for (const r of rows) {
      if (r.contact_id) map.set(r.contact_id, new Date(r.last));
    }
    return map;
  }

  async recentMessages(
    tenantId: string,
    limit: number
  ): Promise<Array<{ body: string | null; channel: string | null }>> {
    return db
      .selectFrom("messages")
      .select(["body", "channel"])
      .where("tenant_id", "=", tenantId)
      .orderBy("at", "desc")
      .limit(limit)
      .execute();
  }

  async recentVoiceCallTranscripts(
    tenantId: string,
    limit: number
  ): Promise<Array<{ transcript: unknown }>> {
    return db
      .selectFrom("voice_calls")
      .select(["transcript"])
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }
}

export default new AnalyticsRepository();
