import { db } from "../db/connection";
import logger from "../utils/logger";
import { LeadScore, scoreLead } from "./ai/heuristics";
import { blendLeadScore } from "./ai/intent";
import engagementService from "./engagement.service";

/**
 * Lead scores are STORED at write time (score_total / score_grade /
 * score_breakdown columns) and recomputed whenever the inputs change (lead
 * fields, activities, messages, voice calls, product events). Lists sort and
 * filter on the stored columns; detail views can still recompute live.
 */
class ScoringService {
  async computeForLead(
    tenantId: string,
    lead: {
      id: string;
      source: string | null;
      tags: unknown;
      notes: string | null;
      budget: boolean;
      last_activity_at: Date | null;
      created_at: Date;
    }
  ): Promise<LeadScore> {
    const [activities, messages] = await Promise.all([
      db
        .selectFrom("activities")
        .select(["type", "lead_id", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", lead.id)
        .execute(),
      db
        .selectFrom("messages")
        .select(["body", "lead_id"])
        .where("tenant_id", "=", tenantId)
        .where("lead_id", "=", lead.id)
        .execute(),
    ]);

    const base = scoreLead(lead, activities, messages);

    // Product intent: the best score across every connected product, because a
    // lead who is hot on ANY of them is a hot lead.
    //
    // Fails soft to null rather than to zero. Null means "no integration data"
    // and preserves the original four-dimension formula exactly; zero would mean
    // "dead on the product" and would silently downgrade every lead in the
    // workspace if this lookup ever broke.
    let product: number | null = null;
    try {
      product = await engagementService.bestIntentFor(tenantId, {
        leadId: lead.id,
        contactId: null,
      });
    } catch (err) {
      logger.warn(`scoring: product intent lookup failed for ${lead.id}: ${String(err)}`);
    }

    const blended = blendLeadScore(base, product);
    return {
      ...base,
      ...(product === null ? {} : { product }),
      total: blended.total,
      grade: blended.grade,
    };
  }

  async recompute(tenantId: string, leadId: string): Promise<LeadScore | null> {
    const lead = await db
      .selectFrom("leads")
      .select(["id", "source", "tags", "notes", "budget", "last_activity_at", "created_at"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", leadId)
      .executeTakeFirst();
    if (!lead) return null;

    const score = await this.computeForLead(tenantId, lead);
    await db
      .updateTable("leads")
      .set({
        score_total: score.total,
        score_grade: score.grade,
        score_breakdown: JSON.stringify(score),
        scored_at: new Date(),
      })
      .where("id", "=", leadId)
      .where("tenant_id", "=", tenantId)
      .execute();
    return score;
  }

  recomputeInBackground(tenantId: string, leadId: string): void {
    this.recompute(tenantId, leadId).catch((err) =>
      logger.warn(`lead score recompute failed for ${leadId}: ${err.message}`)
    );
  }
}

export default new ScoringService();
