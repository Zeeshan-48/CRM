import { Selectable, sql, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { campaign_status } from "../db/enums";
import type { campaigns, DB } from "../db/types";

export type CampaignRow = Selectable<campaigns>;

export interface AudienceLead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface CreateCampaignData {
  tenant_id: string;
  name: string;
  channel: string;
  cost?: number;
  revenue?: number;
  leads_generated?: number;
  status?: campaign_status;
  audience_tag?: string | null;
  subject?: string | null;
  body?: string | null;
  template_params?: string[] | null;
  start_at?: Date | null;
  end_at?: Date | null;
}

// Per-campaign delivery counts derived from message rows (updated by Meta's
// status webhook). `accepted` = messages Meta acknowledged at send time;
// `delivered`/`read`/`failed` arrive asynchronously; `pending` is accepted but
// not yet confirmed delivered or failed.
export interface CampaignDeliveryStats {
  accepted: number;
  delivered: number;
  read: number;
  failed: number;
  pending: number;
}

class CampaignsRepository {
  async list(tenantId: string): Promise<CampaignRow[]> {
    return db
      .selectFrom("campaigns")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("created_at", "desc")
      .execute();
  }

  async findById(id: string, tenantId: string): Promise<CampaignRow | undefined> {
    return db
      .selectFrom("campaigns")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async create(data: CreateCampaignData, trx?: Transaction<DB>): Promise<CampaignRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("campaigns")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        name: data.name,
        channel: data.channel,
        cost: data.cost ?? 0,
        revenue: data.revenue ?? 0,
        leads_generated: data.leads_generated ?? 0,
        status: data.status ?? "ACTIVE",
        audience_tag: data.audience_tag ?? null,
        subject: data.subject ?? null,
        body: data.body ?? null,
        template_params: data.template_params
          ? JSON.stringify(data.template_params)
          : null,
        start_at: data.start_at ?? null,
        end_at: data.end_at ?? null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // The campaign audience: leads carrying the tag (JSONB containment), or all
  // leads when no tag is set. Bounded so a bulk send can't run away.
  async audienceLeads(
    tenantId: string,
    tag: string | null,
    limit = 1000
  ): Promise<AudienceLead[]> {
    let q = db
      .selectFrom("leads")
      .select(["id", "name", "email", "phone"])
      .where("tenant_id", "=", tenantId);
    if (tag) {
      q = q.where(sql<boolean>`tags @> ${JSON.stringify([tag])}::jsonb`);
    }
    return q.orderBy("created_at", "desc").limit(limit).execute();
  }

  // Record the outcome of a send and mark the campaign completed.
  async recordSend(
    id: string,
    tenantId: string,
    data: { recipients: number; sent: number }
  ): Promise<CampaignRow | undefined> {
    return db
      .updateTable("campaigns")
      .set({
        recipients: data.recipients,
        sent: data.sent,
        sent_at: new Date(),
        status: "COMPLETED",
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  // Delivery counts per campaign, from message rows the status webhook updates.
  // Returns a map keyed by campaign_id. Only real (non-simulated) sends count.
  async deliveryStats(
    tenantId: string,
    campaignIds: string[]
  ): Promise<Map<string, CampaignDeliveryStats>> {
    const result = new Map<string, CampaignDeliveryStats>();
    if (campaignIds.length === 0) return result;

    const rows = await db
      .selectFrom("messages")
      .select(["campaign_id", "status", (eb) => eb.fn.count<number>("id").as("count")])
      .where("tenant_id", "=", tenantId)
      .where("campaign_id", "in", campaignIds)
      .where("simulated", "=", false)
      .groupBy(["campaign_id", "status"])
      .execute();

    for (const row of rows) {
      if (!row.campaign_id) continue;
      const stats =
        result.get(row.campaign_id) ??
        { accepted: 0, delivered: 0, read: 0, failed: 0, pending: 0 };
      const n = Number(row.count);
      const status = (row.status ?? "sent").toLowerCase();
      stats.accepted += n;
      if (status === "delivered") stats.delivered += n;
      else if (status === "read") {
        stats.delivered += n;
        stats.read += n;
      } else if (status === "failed") stats.failed += n;
      else stats.pending += n; // "sent"/null → accepted, awaiting confirmation
      result.set(row.campaign_id, stats);
    }
    return result;
  }
}

export default new CampaignsRepository();
