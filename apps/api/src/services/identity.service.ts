import { db } from "../db/connection";
import { BadRequestError } from "../errors";
import identitiesRepository, {
  type IdentityInput,
  type IdentityType,
} from "../repositories/identities.repository";
import leadsRepository from "../repositories/leads.repository";
import { normalizePhone } from "../utils/phone";
import logger from "../utils/logger";
import leadsService from "./leads.service";

export interface IdentityContext {
  tenantId: string;
  appId: string;
  apiKeyCreatedBy: string | null;
  defaultSource: string;
}

export interface ResolvedPerson {
  leadId: string | null;
  contactId: string | null;
  /** true when this call created the lead rather than matching an existing one */
  created: boolean;
  /** true when an identity already pointed at this person before this call */
  matched: boolean;
}

export interface RawIdentity {
  user_id?: unknown;
  external_id?: unknown;
  email?: unknown;
  phone?: unknown;
  anonymous_id?: unknown;
}

const str = (v: unknown): string =>
  typeof v === "string" ? v.trim() : v == null ? "" : String(v);

/**
 * Normalizes the identity block a producer sent into an ORDERED list.
 *
 * Order is evidence strength, and it matters: an explicit product user id is a
 * fact, an email is usually a fact, a phone is often shared, and an anonymous
 * cookie is the weakest (shared devices, cleared storage). Resolving in this
 * order stops a shared browser from merging two people.
 */
export const normalizeIdentities = (raw: RawIdentity | null | undefined): IdentityInput[] => {
  const out: IdentityInput[] = [];
  const source = raw ?? {};

  const userId = str(source.user_id) || str(source.external_id);
  if (userId) out.push({ type: "EXTERNAL_USER_ID", value: userId.slice(0, 200) });

  const email = str(source.email).toLowerCase();
  if (email) out.push({ type: "EMAIL", value: email.slice(0, 320) });

  const rawPhone = str(source.phone);
  if (rawPhone) {
    const phone = normalizePhone(rawPhone);
    if (phone) out.push({ type: "PHONE", value: phone });
  }

  const anon = str(source.anonymous_id);
  if (anon) out.push({ type: "ANONYMOUS_ID", value: anon.slice(0, 200) });

  return out;
};

const valueOf = (identities: IdentityInput[], type: IdentityType): string | null =>
  identities.find((i) => i.type === type)?.value ?? null;

/**
 * Best-effort display name from an email address.
 *
 * `leadsService.create` defaults a nameless lead to "Unknown", which is right
 * for a web form that genuinely captured nothing. Here we always have an email,
 * so a feed full of "Unknown" rows would be self-inflicted: an agent scanning
 * Signals cannot tell one from another. "priya.sharma@acme.example.com" reads far
 * better as "Priya Sharma", and a real name from identify() overwrites it later.
 *
 * Pure, so the parsing rules are unit-testable.
 */
export const deriveNameFromEmail = (email: string): string => {
  const local = String(email || "").split("@")[0] ?? "";
  // Drop a plus-tag: "priya+crm@acme.example.com" is still Priya.
  const base = local.split("+")[0];

  const words = base
    .split(/[._-]+/)
    .map((part) => part.trim())
    // A purely numeric segment is an id, not a name ("john.1987").
    .filter((part) => part.length > 0 && !/^\d+$/.test(part))
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1));

  // Nothing name-like survived (an all-numeric or symbol-only local part).
  // The full email still beats "Unknown" because it identifies the person.
  if (!words.length) return email;

  return words.join(" ").slice(0, 200);
};

class IdentityService {
  /**
   * Resolves an incoming identity block to a person, creating a lead when the
   * producer gave us something durable enough to act on.
   *
   * Resolution order:
   *   1. an identity we have already bound (strongest first)
   *   2. an existing CRM lead matching the email or phone, even if this app has
   *      never seen them (the person may have arrived via a web form months ago)
   *   3. create a lead, but ONLY if we have an email or phone
   *   4. otherwise stay anonymous: record the anonymous id unbound so the events
   *      can be back-filled the moment they identify themselves
   *
   * Step 4 is the important one. Creating a lead per anonymous visitor would
   * flood the CRM with junk and burn the workspace's lead limit on bot traffic.
   */
  async resolve(
    ctx: IdentityContext,
    raw: RawIdentity | null | undefined,
    options: { createIfMissing?: boolean } = {}
  ): Promise<ResolvedPerson> {
    const identities = normalizeIdentities(raw);
    if (!identities.length) {
      return { leadId: null, contactId: null, created: false, matched: false };
    }

    // 1. Already known to this app.
    const bound = await identitiesRepository.findFirstResolved(ctx.tenantId, ctx.appId, identities);
    if (bound) {
      await this.recordAll(ctx, identities, {
        leadId: bound.lead_id,
        contactId: bound.contact_id,
      });
      return {
        leadId: bound.lead_id,
        contactId: bound.contact_id,
        created: false,
        matched: true,
      };
    }

    const email = valueOf(identities, "EMAIL");
    const phone = valueOf(identities, "PHONE");

    // 2. Known to the CRM through some other channel entirely.
    if (email || phone) {
      const lead = await leadsRepository.findByEmailOrPhone(ctx.tenantId, email ?? "", phone ?? "");
      if (lead) {
        await this.recordAll(ctx, identities, { leadId: lead.id, contactId: null });
        return { leadId: lead.id, contactId: null, created: false, matched: true };
      }
    }

    // 3. Create, but only with something durable to create from.
    if ((email || phone) && options.createIfMissing !== false) {
      try {
        const actorId = await this.resolveActor(ctx.tenantId, ctx.apiKeyCreatedBy);
        const lead = await leadsService.create(ctx.tenantId, actorId, {
          // Without this the lead is named "Unknown", and the Signals feed
          // becomes a list of identical rows nobody can act on.
          name: email ? deriveNameFromEmail(email) : undefined,
          email: email ?? "",
          phone: phone ?? "",
          source: ctx.defaultSource || "Product",
        });

        // Stamp provenance so the legacy external_id match keeps working.
        const externalId = valueOf(identities, "EXTERNAL_USER_ID");
        await db
          .updateTable("leads")
          .set({ external_id: externalId, external_source: ctx.defaultSource || "Product" })
          .where("id", "=", lead.id)
          .where("tenant_id", "=", ctx.tenantId)
          .execute()
          .catch(() => undefined);

        await this.recordAll(ctx, identities, { leadId: lead.id, contactId: null });
        return { leadId: lead.id, contactId: null, created: true, matched: false };
      } catch (err) {
        // Capacity limits and validation failures must not loop the producer
        // forever. Record the identities unbound and let the event land as an
        // orphan with the reason attached.
        logger.warn(
          `identity: lead auto-create failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // 4. Stay anonymous, but remember the identity so a later identify() can
    //    retroactively claim everything this visitor did.
    await this.recordAll(ctx, identities, { leadId: null, contactId: null });
    return { leadId: null, contactId: null, created: false, matched: false };
  }

  /**
   * Explicit identify call: binds every supplied identity to one person and
   * back-fills the anonymous history.
   *
   * This is the moment a stranger becomes a lead with three weeks of browsing
   * already attached, which is the whole reason the identity graph exists.
   */
  async identify(
    ctx: IdentityContext,
    body: Record<string, unknown>
  ): Promise<ResolvedPerson & { backfilled: number }> {
    const traits =
      body.traits && typeof body.traits === "object"
        ? (body.traits as Record<string, unknown>)
        : {};

    // Traits carry the durable identifiers; the top level carries the ids.
    const raw: RawIdentity = {
      user_id: body.user_id ?? body.external_id,
      anonymous_id: body.anonymous_id,
      email: traits.email ?? body.email,
      phone: traits.phone ?? body.phone,
    };

    const identities = normalizeIdentities(raw);
    if (!identities.length) {
      throw new BadRequestError(
        "identify needs at least one of user_id, traits.email, traits.phone or anonymous_id"
      );
    }

    const person = await this.resolve(ctx, raw, { createIfMissing: true });

    let backfilled = 0;
    const anon = valueOf(identities, "ANONYMOUS_ID");
    if (anon && (person.leadId || person.contactId)) {
      await identitiesRepository.bindAnonymous(ctx.tenantId, ctx.appId, anon, {
        leadId: person.leadId,
        contactId: person.contactId,
      });
      backfilled = await this.backfillAnonymousEvents(ctx, anon, person);
    }

    // Fill blanks on the lead from the traits, never overwriting a human's entry.
    if (person.leadId) {
      await this.enrichLead(ctx.tenantId, person.leadId, traits);
    }

    return { ...person, backfilled };
  }

  /**
   * Re-points every event this anonymous visitor produced at the person they
   * turned out to be. Bounded and indexed on (tenant, app, anonymous_id).
   */
  async backfillAnonymousEvents(
    ctx: IdentityContext,
    anonymousId: string,
    person: { leadId: string | null; contactId: string | null }
  ): Promise<number> {
    if (!person.leadId && !person.contactId) return 0;
    try {
      const result = await db
        .updateTable("activity_events")
        .set({
          lead_id: person.leadId,
          contact_id: person.contactId,
          // These rows landed as ORPHAN because nobody owned them yet. They are
          // real, matched events now.
          status: "RECORDED",
        })
        .where("tenant_id", "=", ctx.tenantId)
        .where("app_id", "=", ctx.appId)
        .where("anonymous_id", "=", anonymousId)
        .where("lead_id", "is", null)
        .where("contact_id", "is", null)
        .executeTakeFirst();
      return Number(result?.numUpdatedRows ?? 0);
    } catch (err) {
      logger.warn(`identity: anonymous back-fill failed: ${String(err)}`);
      return 0;
    }
  }

  /** Records every identity in the block, all pointing at the same person. */
  private async recordAll(
    ctx: IdentityContext,
    identities: IdentityInput[],
    person: { leadId: string | null; contactId: string | null }
  ): Promise<void> {
    for (const identity of identities) {
      await identitiesRepository
        .upsert({
          tenant_id: ctx.tenantId,
          app_id: ctx.appId,
          identity_type: identity.type,
          identity_value: identity.value,
          lead_id: person.leadId,
          contact_id: person.contactId,
        })
        .catch((err) => logger.warn(`identity upsert failed: ${String(err)}`));
    }
  }

  /**
   * Fills ONLY empty fields on a matched lead. Never overwrites something a
   * human typed: the product knows the person's login email, the sales agent
   * knows which email they actually reply to.
   */
  private async enrichLead(
    tenantId: string,
    leadId: string,
    traits: Record<string, unknown>
  ): Promise<void> {
    try {
      const lead = await leadsRepository.findById(leadId, tenantId);
      if (!lead) return;

      const patch: Parameters<typeof leadsRepository.update>[2] = {};
      const name = str(traits.name) || [str(traits.first_name), str(traits.last_name)].filter(Boolean).join(" ");
      // A real name from the product beats a placeholder, which is any of:
      // empty, "Unknown", the raw email, or the name we derived from the email.
      // Anything else was typed by a human and is never overwritten.
      const derived = lead.email ? deriveNameFromEmail(lead.email) : null;
      const isPlaceholder =
        !lead.name ||
        lead.name === "Unknown" ||
        lead.name === lead.email ||
        (derived !== null && lead.name === derived);
      if (name && isPlaceholder) patch.name = name.slice(0, 200);

      const email = str(traits.email).toLowerCase();
      if (email && !lead.email) patch.email = email;

      const phone = str(traits.phone);
      if (phone && !lead.phone) {
        const normalized = normalizePhone(phone);
        if (normalized) patch.phone = normalized;
      }

      const city = str(traits.city);
      if (city && !lead.city) patch.city = city;

      if (Object.keys(patch).length) {
        await leadsRepository.update(leadId, tenantId, patch);
      }
    } catch (err) {
      logger.warn(`identity: lead enrich failed: ${String(err)}`);
    }
  }

  /**
   * A real active user to own auto-created leads and attribute audits. Prefers
   * the API key's creator, then any ADMIN, then any active user. Mirrors the
   * existing ingest.service behaviour so both paths agree on ownership.
   */
  private async resolveActor(tenantId: string, createdBy: string | null): Promise<string> {
    if (createdBy) {
      const u = await db
        .selectFrom("users")
        .select(["id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", createdBy)
        .where("status", "=", "ACTIVE")
        .executeTakeFirst();
      if (u) return u.id;
    }
    const admin = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .where("role", "=", "ADMIN")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (admin) return admin.id;
    const any = await db
      .selectFrom("users")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "ACTIVE")
      .orderBy("created_at", "asc")
      .executeTakeFirst();
    if (any) return any.id;
    throw new BadRequestError("Workspace has no active user to own product-sourced leads");
  }
}

export default new IdentityService();
