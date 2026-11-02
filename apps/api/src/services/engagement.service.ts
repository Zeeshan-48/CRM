import { db } from "../db/connection";
import activityEventsRepository from "../repositories/activity-events.repository";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import engagementRepository, {
  type EngagementProfileRow,
  type PersonRef,
} from "../repositories/engagement.repository";
import eventDefinitionsRepository from "../repositories/event-definitions.repository";
import identitiesRepository from "../repositories/identities.repository";
import { formatMoney } from "../utils/money";
import logger from "../utils/logger";
import { computeIntent, INTENT_WINDOW_DAYS, type IntentEvent } from "./ai/intent";
import {
  foldEvent,
  toProfileState,
  type FoldInput,
  type ProfileState,
} from "./engagement-fold";

export interface ApplyEventInput extends FoldInput {
  tenantId: string;
  appId: string;
  person: PersonRef;
  /** TEST-environment traffic is stored but must never move a real lead score. */
  scoring: boolean;
}

export interface EngagementView {
  app_id: string;
  app_name: string;
  app_key: string;
  product_url: string | null;
  lifecycle_stage: string;
  plan_name: string | null;
  plan_status: string | null;
  mrr_minor: number | null;
  mrr_display: string | null;
  currency: string | null;
  first_seen_at: Date | null;
  last_seen_at: Date | null;
  signup_at: Date | null;
  trial_ends_at: Date | null;
  sessions_30d: number;
  events_30d: number;
  page_views_30d: number;
  active_days_30d: number;
  intent_score: number;
  intent_band: string;
  intent_reasons: Array<{ label: string; weight: number; count: number }>;
  checkout_abandoned_at: Date | null;
  abandoned_cart: Record<string, unknown> | null;
  top_products: unknown[];
  usage: Record<string, unknown>;
}

const parse = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const toDate = (iso: string | null): Date | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

class EngagementService {
  /**
   * Folds one event into the person's profile for that connected product.
   *
   * Best-effort by design: the event itself is already durably stored by the
   * time this runs, so a rollup failure must degrade the panel, never fail an
   * ingest the producer already got a 201 for.
   */
  async applyEvent(input: ApplyEventInput): Promise<void> {
    if (!input.person.leadId && !input.person.contactId) return;

    try {
      const profile = await engagementRepository.ensure(
        input.tenantId,
        input.appId,
        input.person
      );

      const current: ProfileState = toProfileState(profile);
      const next = foldEvent(current, {
        event: input.event,
        occurredAtIso: input.occurredAtIso,
        properties: input.properties,
        product: input.product,
      });

      await engagementRepository.update(profile.id, input.tenantId, {
        lifecycle_stage: next.lifecycle_stage,
        plan_name: next.plan_name,
        plan_status: next.plan_status,
        mrr_minor: next.mrr_minor,
        currency: next.currency,
        signup_at: toDate(next.signup_at),
        trial_ends_at: toDate(next.trial_ends_at),
        checkout_abandoned_at: toDate(next.checkout_abandoned_at),
        abandoned_cart: next.abandoned_cart,
        top_products: next.top_products,
        usage: next.usage,
      });

      const occurredAt = new Date(input.occurredAtIso);
      if (!Number.isNaN(occurredAt.getTime())) {
        await engagementRepository.touchSeen(profile.id, occurredAt);
      }

      // Recompute intent inline so the panel and the signals feed are correct
      // immediately after a high-intent event, rather than up to a sweep later.
      // TEST-environment apps are excluded: rehearsal traffic must never move a
      // real lead's score.
      if (input.scoring) {
        await this.recompute(input.tenantId, profile.id).catch((err) =>
          logger.warn(`engagement: inline recompute failed: ${String(err)}`)
        );
      }
    } catch (err) {
      logger.warn(`engagement: applyEvent failed: ${String(err)}`);
    }
  }

  /**
   * Recomputes the 30-day windows and the intent score for one profile from the
   * stored event stream. Idempotent: it derives everything from events rather
   * than accumulating, so running it twice changes nothing.
   */
  async recompute(tenantId: string, profileId: string): Promise<EngagementProfileRow | undefined> {
    const profile = await db
      .selectFrom("engagement_profiles")
      .selectAll()
      .where("id", "=", profileId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    if (!profile) return undefined;

    const since = new Date(Date.now() - INTENT_WINDOW_DAYS * 86_400_000);
    const [events, definitions] = await Promise.all([
      activityEventsRepository.listForRollup(
        tenantId,
        profile.app_id,
        { leadId: profile.lead_id, contactId: profile.contact_id },
        since
      ),
      eventDefinitionsRepository.listForApp(tenantId, profile.app_id),
    ]);

    // Only ACTIVE definitions contribute to the score. An auto-registered event
    // sitting at NEEDS_REVIEW is stored and displayed but must not move anyone's
    // number until a human has decided what it means.
    const weights = new Map(
      definitions
        .filter((d) => d.review_status === "ACTIVE")
        .map((d) => [d.name, { weight: d.intent_weight, label: d.label }])
    );

    const sessions = new Set<string>();
    const activeDays = new Set<string>();
    let pageViews = 0;
    const intentEvents: IntentEvent[] = [];

    for (const e of events) {
      if (e.session_id) sessions.add(e.session_id);
      activeDays.add(new Date(e.occurred_at).toISOString().slice(0, 10));
      if (e.event === "page.viewed") pageViews += 1;

      const def = weights.get(e.event);
      if (def) {
        intentEvents.push({
          event: e.event,
          label: def.label,
          occurred_at: e.occurred_at,
          weight: def.weight,
        });
      }
    }

    const intent = computeIntent(intentEvents, {
      checkoutAbandoned: !!profile.checkout_abandoned_at,
    });

    return engagementRepository.update(profile.id, tenantId, {
      sessions_30d: sessions.size,
      events_30d: events.length,
      page_views_30d: pageViews,
      active_days_30d: activeDays.size,
      intent_score: intent.score,
      intent_band: intent.band,
      intent_reasons: intent.reasons,
    });
  }

  /** Every connected product's engagement for one person, for the record panel. */
  async listForPerson(tenantId: string, person: PersonRef): Promise<EngagementView[]> {
    const [profiles, apps] = await Promise.all([
      engagementRepository.listForPerson(tenantId, person),
      connectedAppsRepository.list(tenantId),
    ]);
    const appById = new Map(apps.map((a) => [a.id, a]));

    return profiles
      .filter((p) => appById.has(p.app_id))
      .map((p) => {
        const app = appById.get(p.app_id)!;
        return {
          app_id: p.app_id,
          app_name: app.name,
          app_key: app.key,
          product_url: app.product_url,
          lifecycle_stage: p.lifecycle_stage,
          plan_name: p.plan_name,
          plan_status: p.plan_status,
          mrr_minor: p.mrr_minor,
          mrr_display:
            p.mrr_minor !== null ? formatMoney(p.mrr_minor, p.currency ?? "INR") : null,
          currency: p.currency,
          first_seen_at: p.first_seen_at,
          last_seen_at: p.last_seen_at,
          signup_at: p.signup_at,
          trial_ends_at: p.trial_ends_at,
          sessions_30d: p.sessions_30d,
          events_30d: p.events_30d,
          page_views_30d: p.page_views_30d,
          active_days_30d: p.active_days_30d,
          intent_score: p.intent_score,
          intent_band: p.intent_band,
          intent_reasons: parse<Array<{ label: string; weight: number; count: number }>>(
            p.intent_reasons,
            []
          ),
          checkout_abandoned_at: p.checkout_abandoned_at,
          abandoned_cart: parse<Record<string, unknown> | null>(p.abandoned_cart, null),
          top_products: parse<unknown[]>(p.top_products, []),
          usage: parse<Record<string, unknown>>(p.usage, {}),
        };
      });
  }

  /**
   * The best intent score across every connected product for one person.
   * Feeds the CRM lead score: a lead who is hot on ANY product is a hot lead.
   */
  async bestIntentFor(tenantId: string, person: PersonRef): Promise<number | null> {
    const profiles = await engagementRepository.listForPerson(tenantId, person);
    if (!profiles.length) return null;
    return profiles.reduce((max, p) => Math.max(max, p.intent_score), 0);
  }

  /**
   * The signals feed: who is hot right now, across every connected product.
   *
   * This is the surface neither Salesforce nor Zoho ships natively. It is cheap
   * for us because the rollup already stores the score, so the whole feed is one
   * indexed query plus two name lookups, not a scan of the event table.
   */
  async signals(
    tenantId: string,
    filters: { appId?: string; band?: string; limit?: number } = {}
  ) {
    const profiles = await engagementRepository.listSignals(tenantId, {
      appId: filters.appId ?? null,
      band: filters.band ?? null,
      limit: filters.limit,
    });
    if (!profiles.length) return [];

    const leadIds = profiles.map((p) => p.lead_id).filter((id): id is string => !!id);
    const contactIds = profiles.map((p) => p.contact_id).filter((id): id is string => !!id);

    const [apps, leads, contacts] = await Promise.all([
      connectedAppsRepository.list(tenantId),
      leadIds.length
        ? db
            .selectFrom("leads")
            .select(["id", "name", "email", "owner_id", "status", "score_grade"])
            .where("tenant_id", "=", tenantId)
            .where("id", "in", leadIds)
            .execute()
        : Promise.resolve([]),
      contactIds.length
        ? db
            .selectFrom("contacts")
            .select(["id", "name", "email", "owner_id", "lifecycle"])
            .where("tenant_id", "=", tenantId)
            .where("id", "in", contactIds)
            .execute()
        : Promise.resolve([]),
    ]);

    const appById = new Map(apps.map((a) => [a.id, a]));
    const leadById = new Map(leads.map((l) => [l.id, l]));
    const contactById = new Map(contacts.map((c) => [c.id, c]));

    return profiles
      .map((p) => {
        const app = appById.get(p.app_id);
        const lead = p.lead_id ? leadById.get(p.lead_id) : undefined;
        const contact = p.contact_id ? contactById.get(p.contact_id) : undefined;
        const person = contact ?? lead;
        // A profile whose person or app was deleted is stale noise, not a signal.
        if (!person || !app) return null;

        return {
          profile_id: p.id,
          app_id: p.app_id,
          app_name: app.name,
          lead_id: p.lead_id,
          contact_id: p.contact_id,
          name: person.name,
          email: person.email,
          owner_id: person.owner_id,
          record_type: contact ? ("contact" as const) : ("lead" as const),
          lifecycle_stage: p.lifecycle_stage,
          plan_name: p.plan_name,
          plan_status: p.plan_status,
          intent_score: p.intent_score,
          intent_band: p.intent_band,
          intent_reasons: parse<Array<{ label: string; weight: number; count: number }>>(
            p.intent_reasons,
            []
          ),
          checkout_abandoned_at: p.checkout_abandoned_at,
          last_seen_at: p.last_seen_at,
          events_30d: p.events_30d,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /**
   * Removes every product-integration row belonging to a deleted person.
   *
   * None of these tables carries a foreign key to `leads` or `contacts` (the
   * same choice the rest of this schema makes), so nothing cascades on its own.
   * Skipping this leaves an identity pointing at a record that no longer exists,
   * and every later event for that person resolves to it: the producer keeps
   * sending, the API keeps answering 201, and the data is invisible forever.
   *
   * Awaited, and deliberately NOT best-effort: the caller runs this before the
   * delete so a failure leaves the person intact and the operation retryable.
   */
  async purgePerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null }
  ): Promise<void> {
    if (!person.leadId && !person.contactId) return;
    await Promise.all([
      identitiesRepository.deleteForPerson(tenantId, person),
      engagementRepository.deleteForPerson(tenantId, person),
      activityEventsRepository.deleteForPerson(tenantId, person),
    ]);
  }

  /** Carries a converting lead's product history onto its new contact. */
  async carryToContact(tenantId: string, leadId: string, contactId: string): Promise<void> {
    try {
      await Promise.all([
        engagementRepository.movePerson(tenantId, leadId, contactId),
        activityEventsRepository.movePerson(tenantId, leadId, contactId),
      ]);
    } catch (err) {
      // Conversion must succeed even if the carry-over does not; the events are
      // still reachable through the lead id.
      logger.warn(`engagement: carry to contact failed: ${String(err)}`);
    }
  }
}

export default new EngagementService();
