import { canonicalEventName, findKnownEvent } from "../constants/semantic-events.const";
import { BadRequestError } from "../errors";
import activityEventsRepository, {
  type ActivityEventRow,
} from "../repositories/activity-events.repository";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import eventDefinitionsRepository, {
  type EventDefinitionRow,
} from "../repositories/event-definitions.repository";
import leadsRepository from "../repositories/leads.repository";
import productsRepository from "../repositories/products.repository";
import { normalizeCurrency, toMinorUnits } from "../utils/money";
import logger from "../utils/logger";
import engagementService from "./engagement.service";
import engineService from "./engine.service";
import identityService, { type IdentityContext } from "./identity.service";
import type { IngestContext } from "./ingest.service";
import scoringService from "./scoring.service";

const MAX_BATCH = 500;
const MAX_EVENT_NAME_LEN = 120;
// An event name a product sends must look like a name, not like an injection
// attempt or a stringified object. Rejecting here keeps the registry legible.
const EVENT_NAME_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i;

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v);

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const prettyEvent = (name: string): string => {
  const [entity, action] = name.split(".");
  const label = `${entity ?? ""} ${(action ?? "").replace(/_/g, " ")}`.trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name;
};

export interface ActivityEventResult {
  ok: true;
  eventId: string | null;
  leadId: string | null;
  contactId?: string | null;
  /** true = attached to a pre-existing person; false = auto-created or anonymous */
  matched: boolean;
  deduped: boolean;
  /** true when this event name had never been seen and was registered on the fly */
  registered?: boolean;
}

export interface BatchResult {
  ok: true;
  received: number;
  recorded: number;
  deduped: number;
  orphaned: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
}

class ActivityEventsService {
  // ---- Event definition resolution ----

  /**
   * Resolves the definition for an incoming event name, registering it if this
   * is the first time we have seen it.
   *
   * This is the core DX decision of the whole platform: an unknown event is
   * ACCEPTED, not rejected. HubSpot 400s an event you have not pre-declared,
   * which blocks a producer at 3am over a schema they forgot. Segment accepts
   * anything and gives you a landfill. We accept it, register it as
   * NEEDS_REVIEW with weight 0 so it cannot move anyone's score until a human
   * decides what it means, and surface it in the console for labelling.
   *
   * Names we already know (semantic or legacy) register with their real metadata
   * and go straight to ACTIVE, so a standard integration works on day one.
   */
  private async resolveDefinition(
    tenantId: string,
    appId: string,
    name: string
  ): Promise<EventDefinitionRow> {
    const existing = await eventDefinitionsRepository.findByName(tenantId, appId, name);
    if (existing) return existing;

    const known = findKnownEvent(name);
    if (known) {
      return eventDefinitionsRepository.create({
        tenant_id: tenantId,
        app_id: appId,
        name: known.name,
        label: known.label,
        description: known.description,
        category: known.category,
        icon: known.icon,
        intent_weight: known.intent_weight,
        is_high_intent: known.is_high_intent,
        review_status: "ACTIVE",
        auto_registered: false,
      });
    }

    return eventDefinitionsRepository.autoRegister(tenantId, appId, name, prettyEvent(name));
  }

  // ---- Single event ----

  async ingestEvent(ctx: IngestContext, raw: unknown): Promise<ActivityEventResult> {
    const body = asObject(raw);
    const event = str(body.event);
    const idempotencyKey = str(body.idempotency_key);

    if (!event) throw new BadRequestError("event is required");
    if (event.length > MAX_EVENT_NAME_LEN || !EVENT_NAME_PATTERN.test(event)) {
      throw new BadRequestError(
        `Invalid event name "${event.slice(0, 60)}". Use dotted lower-case names such as "checkout.started".`
      );
    }
    if (!idempotencyKey) throw new BadRequestError("idempotency_key is required");

    const occurredAt = new Date(str(body.occurred_at));
    if (Number.isNaN(occurredAt.getTime())) {
      throw new BadRequestError("A valid occurred_at (ISO timestamp) is required");
    }

    // Idempotency short-circuits before any write, so producer and webhook
    // redeliveries are free and never double-count a rollup.
    const prior = await activityEventsRepository.findByIdempotencyKey(ctx.tenantId, idempotencyKey);
    if (prior) {
      return {
        ok: true,
        eventId: prior.id,
        leadId: prior.lead_id,
        contactId: prior.contact_id,
        matched: !!(prior.lead_id || prior.contact_id),
        deduped: true,
      };
    }

    return this.record(ctx, body, event, idempotencyKey, occurredAt);
  }

  // ---- Batch ----

  /**
   * Batch ingest. Deliberately per-event fault isolation: one malformed event in
   * a batch of 500 must not reject the other 499, because a producer replaying a
   * queue cannot easily retry a partial batch.
   */
  async ingestBatch(ctx: IngestContext, raw: unknown): Promise<BatchResult> {
    const body = asObject(raw);
    const events = Array.isArray(body.events) ? body.events : null;
    if (!events) throw new BadRequestError("events must be an array");
    if (events.length > MAX_BATCH) {
      throw new BadRequestError(`At most ${MAX_BATCH} events per batch`);
    }

    // One query for the whole batch instead of one per event.
    const keys = events
      .map((e) => str(asObject(e).idempotency_key))
      .filter(Boolean);
    const seen = await activityEventsRepository.findExistingKeys(ctx.tenantId, keys);

    const result: BatchResult = {
      ok: true,
      received: events.length,
      recorded: 0,
      deduped: 0,
      orphaned: 0,
      rejected: 0,
      errors: [],
    };

    for (let i = 0; i < events.length; i += 1) {
      const item = asObject(events[i]);
      const key = str(item.idempotency_key);
      if (key && seen.has(key)) {
        result.deduped += 1;
        continue;
      }
      try {
        const one = await this.ingestEvent(ctx, item);
        if (one.deduped) result.deduped += 1;
        else if (one.leadId || one.contactId) result.recorded += 1;
        else result.orphaned += 1;
        // Guards against a batch that repeats the same key internally.
        if (key) seen.add(key);
      } catch (err) {
        result.rejected += 1;
        result.errors.push({
          index: i,
          error: err instanceof Error ? err.message : "failed",
        });
      }
    }

    return result;
  }

  // ---- Core record path ----

  private async record(
    ctx: IngestContext,
    body: Record<string, unknown>,
    event: string,
    idempotencyKey: string,
    occurredAt: Date
  ): Promise<ActivityEventResult> {
    // Always present: /ingest/events is API-key authenticated, and every key
    // resolves to exactly one connected product. The guard is here so a future
    // caller cannot quietly write events with no product attribution.
    const appId = ctx.appId;
    if (!appId) {
      throw new BadRequestError("Product events require an API key bound to a connected product");
    }

    const properties = asObject(body.properties);
    const context = asObject(body.context);
    const identityBlock = asObject(body.identity);

    const definition = await this.resolveDefinition(ctx.tenantId, appId, event);

    // Identity: resolve, and create a lead only when there is something durable
    // to create from. An anonymous-only visitor stays anonymous by design.
    const identityCtx: IdentityContext = {
      tenantId: ctx.tenantId,
      appId,
      apiKeyCreatedBy: ctx.apiKeyCreatedBy,
      defaultSource: ctx.defaultSource,
    };
    const person = await identityService.resolve(identityCtx, {
      user_id: identityBlock.user_id ?? identityBlock.external_id,
      email: identityBlock.email,
      phone: identityBlock.phone,
      anonymous_id: identityBlock.anonymous_id ?? context.anonymous_id,
    });

    const product = await this.resolveProduct(ctx.tenantId, appId, body);
    const anonymousId =
      str(identityBlock.anonymous_id) || str(context.anonymous_id) || null;

    const hasPerson = !!(person.leadId || person.contactId);
    const status = hasPerson ? "RECORDED" : "ORPHAN";

    let row: ActivityEventRow;
    try {
      row = await activityEventsRepository.insertEvent({
        tenant_id: ctx.tenantId,
        api_key_id: ctx.apiKeyId,
        lead_id: person.leadId,
        contact_id: person.contactId,
        event,
        title: str(body.title) || null,
        status,
        occurred_at: occurredAt,
        idempotency_key: idempotencyKey,
        payload: body,
        error: hasPerson ? null : "no identity yet; will be claimed on identify",
        app_id: appId,
        product_id: product?.id ?? null,
        anonymous_id: anonymousId,
        session_id: str(context.session_id) || null,
        page_url: str(context.page_url) || str(context.url) || null,
        referrer: str(context.referrer) || null,
        value_minor: toMinorUnits(properties.value ?? properties.value_minor),
        currency: properties.currency ? normalizeCurrency(properties.currency) : null,
      });
    } catch {
      // Idempotency race: another delivery inserted the same key between our
      // check and now. Return the winner as a dedup.
      const existing = await activityEventsRepository.findByIdempotencyKey(
        ctx.tenantId,
        idempotencyKey
      );
      if (existing) {
        return {
          ok: true,
          eventId: existing.id,
          leadId: existing.lead_id,
          contactId: existing.contact_id,
          matched: !!(existing.lead_id || existing.contact_id),
          deduped: true,
        };
      }
      throw new BadRequestError("Failed to record event");
    }

    // ---- Everything below is instrumentation and rollup: the event is already
    // durably stored, so none of it may fail the request. ----

    eventDefinitionsRepository
      .touchSeen(definition.id)
      .catch((err) => logger.warn(`event definition touch failed: ${String(err)}`));
    connectedAppsRepository
      .touchEvent(appId)
      .catch((err) => logger.warn(`app health touch failed: ${String(err)}`));

    const scoring = ctx.environment !== "TEST";

    if (hasPerson) {
      await engagementService.applyEvent({
        tenantId: ctx.tenantId,
        appId,
        person: { leadId: person.leadId, contactId: person.contactId },
        event,
        occurredAtIso: occurredAt.toISOString(),
        properties,
        product,
        // TEST-environment traffic is stored and visible but never moves a real
        // lead's score, so a team can rehearse against production data safely.
        scoring,
      });

      if (person.leadId) {
        activityEventsRepository
          .touchLeadActivity(ctx.tenantId, person.leadId, occurredAt)
          .catch((err) => logger.warn(`lead activity touch failed: ${String(err)}`));

        if (scoring) {
          // The CRM lead grade now has a product dimension, so refresh it. Fire
          // and forget: the event is stored either way, and the sweep would pick
          // this up regardless.
          scoringService.recomputeInBackground(ctx.tenantId, person.leadId);
        }

        this.fireAutomation(ctx, person.leadId, event, definition, scoring);
      }
    }

    engineService.audit(ctx.tenantId, ctx.apiKeyCreatedBy, "activity.ingested", "lead", person.leadId ?? undefined, {
      event,
      app: ctx.appName,
      matched: person.matched,
      via: "api_key",
    });

    return {
      ok: true,
      eventId: row.id,
      leadId: person.leadId,
      contactId: person.contactId,
      matched: person.matched,
      deduped: false,
      registered: definition.auto_registered && definition.event_count === 0,
    };
  }

  /**
   * Fires workflow triggers and alerts the lead owner for a high-intent event.
   *
   * Entirely fire-and-forget: the event is already stored and acknowledged, and
   * an automation failure must never surface to the producer as a failed ingest.
   * TEST-environment traffic fires nothing, so rehearsing an integration cannot
   * spam a real sales team with alerts.
   */
  private fireAutomation(
    ctx: IngestContext,
    leadId: string,
    event: string,
    definition: EventDefinitionRow,
    scoring: boolean
  ): void {
    if (!scoring) return;

    const canonical = canonicalEventName(event);
    const triggers: string[] = ["product.event"];
    if (definition.is_high_intent && definition.review_status === "ACTIVE") {
      triggers.push("product.high_intent");
    }
    if (canonical === "checkout.started" || canonical === "checkout.abandoned") {
      triggers.push("product.checkout_abandoned");
    }
    if (canonical === "trial.ending") triggers.push("product.trial_ending");
    if (canonical === "limit.reached") triggers.push("product.limit_reached");

    void (async () => {
      try {
        const lead = await leadsRepository.findById(leadId, ctx.tenantId);
        if (!lead) return;

        const workflowLead = {
          id: lead.id,
          name: lead.name,
          owner_id: lead.owner_id,
          tags: lead.tags,
        };
        for (const trigger of triggers) {
          await engineService.emit(ctx.tenantId, ctx.apiKeyCreatedBy, trigger, {
            lead: workflowLead,
          });
        }

        // A high-intent event is worth interrupting an agent for. Only ACTIVE
        // definitions qualify, so an auto-registered event cannot start paging
        // people before a human has decided it matters.
        if (
          lead.owner_id &&
          definition.is_high_intent &&
          definition.review_status === "ACTIVE"
        ) {
          engineService.notify(
            ctx.tenantId,
            lead.owner_id,
            `${lead.name}: ${definition.label} on ${ctx.appName ?? "your product"}`,
            `/leads/${lead.id}`
          );
        }
      } catch (err) {
        logger.warn(`product automation dispatch failed: ${String(err)}`);
      }
    })();
  }

  /**
   * Resolves the catalog item an event is about.
   *
   * Never creates a product: a catalog is published deliberately through
   * /ingest/catalog, and letting an event conjure half-formed products would
   * fill the agent's panel with untitled, unpriced rows.
   */
  private async resolveProduct(
    tenantId: string,
    appId: string,
    body: Record<string, unknown>
  ): Promise<{ id: string | null; external_id: string | null; name: string | null } | null> {
    const ref = asObject(body.product);
    const externalId =
      str(ref.external_id) || str(ref.id) || str(asObject(body.properties).product_id);
    const name = str(ref.name) || null;
    if (!externalId) return name ? { id: null, external_id: null, name } : null;

    try {
      const found = await productsRepository.findByExternalId(tenantId, appId, externalId);
      return {
        id: found?.id ?? null,
        external_id: externalId,
        name: found?.name ?? name,
      };
    } catch (err) {
      logger.warn(`product resolve failed: ${String(err)}`);
      return { id: null, external_id: externalId, name };
    }
  }

  // ---- Reads ----

  /**
   * The person's product-activity stream for the UI. The acted-on product and
   * the definition's presentation metadata are joined in so the frontend can
   * render and group any event, including ones this build has never heard of.
   */
  async listForPerson(
    tenantId: string,
    person: { leadId?: string | null; contactId?: string | null },
    options: { appId?: string | null; limit?: number } = {}
  ) {
    const rows = await activityEventsRepository.listForPerson(tenantId, person, options);
    if (!rows.length) return [];

    const definitions = await eventDefinitionsRepository.listForTenant(tenantId);
    const byKey = new Map(definitions.map((d) => [`${d.app_id}:${d.name}`, d]));

    return rows.map((r) => {
      const def = r.app_id ? byKey.get(`${r.app_id}:${r.event}`) : undefined;
      return {
        id: r.id,
        tenant_id: r.tenant_id,
        app_id: r.app_id,
        lead_id: r.lead_id,
        contact_id: r.contact_id,
        product_id: r.product_id,
        event: r.event,
        label: def?.label ?? prettyEvent(r.event),
        category: def?.category ?? "ACTION",
        icon: def?.icon ?? null,
        is_high_intent: def?.is_high_intent ?? false,
        title: r.title,
        status: r.status,
        occurred_at: r.occurred_at,
        created_at: r.created_at,
        page_url: r.page_url,
        session_id: r.session_id,
        value_minor: r.value_minor,
        currency: r.currency,
        // The legacy contract put the acted-on type in properties.content_type.
        // Kept so the existing Platform tab filter keeps working unchanged.
        content_type: this.extractContentType(r.payload),
      };
    });
  }

  /** Back-compat wrapper for the original lead-scoped listing. */
  async listForLead(tenantId: string, leadId: string, limit = 100) {
    return this.listForPerson(tenantId, { leadId }, { limit });
  }

  private extractContentType(payload: unknown): string | null {
    let p: unknown = payload;
    if (typeof p === "string") {
      try {
        p = JSON.parse(p);
      } catch {
        return null;
      }
    }
    if (!p || typeof p !== "object") return null;
    const props = (p as Record<string, unknown>).properties;
    const ct =
      props && typeof props === "object"
        ? (props as Record<string, unknown>).content_type
        : undefined;
    return typeof ct === "string" && ct.trim() ? ct.trim() : null;
  }
}

export default new ActivityEventsService();
