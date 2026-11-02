import { contact_lifecycle } from "../db/enums";
import { BadRequestError, NotFoundError } from "../errors";
import { assertCanManageRecord } from "../utils/record-policy";
import contactsRepository, { ContactRow } from "../repositories/contacts.repository";
import { normalizePhoneForStore } from "../utils/phone";
import activityEventsService from "./activity-events.service";
import engagementService from "./engagement.service";
import engineService from "./engine.service";

interface TimelineItem {
  kind: "activity" | "message" | "call" | "meeting" | "ticket" | "product";
  at: Date;
  label: string | null;
  type: string | null;
  /** Product events only: flagged on the event definition as a buying signal. */
  highIntent?: boolean;
}

// How many product events to fold into a contact's timeline. A busy product can
// report thousands per person; the timeline is a narrative, not an audit log, so
// it takes the most recent slice and leaves the full stream to the Product tab.
const TIMELINE_PRODUCT_EVENTS = 50;

const LIFECYCLES = Object.values(contact_lifecycle);

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const parseSocials = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const asLifecycle = (value: unknown): contact_lifecycle | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !LIFECYCLES.includes(value as contact_lifecycle)) {
    throw new BadRequestError(`lifecycle must be one of ${LIFECYCLES.join(", ")}`);
  }
  return value as contact_lifecycle;
};

class ContactsService {
  async list(tenantId: string, params: { q?: string; lifecycle?: string }) {
    return contactsRepository.list(tenantId, {
      q: params.q,
      lifecycle: asLifecycle(params.lifecycle),
    });
  }

  async detail(tenantId: string, contactId: string) {
    const contact = await contactsRepository.findById(contactId, tenantId);
    if (!contact) throw new NotFoundError("Contact not found");

    const relations = await contactsRepository.detailRelations(tenantId, contact);

    // What the person did in the connected products, interleaved with what the
    // team did to them. Without this an agent has to read two lists side by side
    // to notice that the "just checking in" email landed the day after three
    // pricing-page visits.
    const productEvents = await activityEventsService.listForPerson(
      tenantId,
      { contactId: contact.id },
      { limit: TIMELINE_PRODUCT_EVENTS }
    );

    const timeline: TimelineItem[] = [
      ...relations.activities.map((a) => ({
        kind: "activity" as const,
        at: a.created_at,
        label: a.subject,
        type: a.type as string,
      })),
      ...relations.messages.map((m) => ({
        kind: "message" as const,
        at: m.at,
        label: m.body.slice(0, 60),
        type: m.channel as string,
      })),
      ...relations.calls.map((v) => ({
        kind: "call" as const,
        at: v.created_at,
        label: v.summary || "Voice call",
        type: v.outcome,
      })),
      ...relations.meetings.map((m) => ({
        kind: "meeting" as const,
        at: m.start_at,
        label: m.title,
        type: m.mode as string,
      })),
      ...relations.tickets.map((t) => ({
        kind: "ticket" as const,
        at: t.created_at,
        label: t.subject,
        type: t.status as string,
      })),
      ...productEvents.map((e) => ({
        kind: "product" as const,
        at: e.occurred_at,
        label: e.label || e.title || e.event,
        // The event's own category (PAGE / ACTION / LIFECYCLE / COMMERCE / SUPPORT)
        // is the `type`, so the timeline filter groups product activity the same
        // way it groups channels, with no CRM knowledge of the product's names.
        type: e.category,
        highIntent: e.is_high_intent,
      })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return { ...contact, ...relations, timeline };
  }

  async create(
    tenantId: string,
    actorId: string,
    body: {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      account_id?: string;
      title?: string;
      city?: string;
      owner_id?: string;
      tags?: unknown;
      socials?: unknown;
      lifecycle?: string;
    }
  ): Promise<ContactRow> {
    if (!body.name) throw new BadRequestError("name is required");

    const contact = await contactsRepository.create({
      tenant_id: tenantId,
      name: body.name,
      email: body.email,
      phone: normalizePhoneForStore(body.phone),
      company: body.company,
      account_id: body.account_id ?? null,
      title: body.title,
      city: body.city,
      owner_id: body.owner_id ?? actorId,
      tags: parseStringArray(body.tags),
      socials: parseSocials(body.socials) ?? {},
      lifecycle: asLifecycle(body.lifecycle),
    });

    engineService.audit(tenantId, actorId, "contact.created", "contact", contact.id, {});
    return contact;
  }

  async update(
    tenantId: string,
    actorId: string,
    contactId: string,
    body: {
      name?: string;
      email?: string;
      phone?: string;
      company?: string;
      account_id?: string | null;
      title?: string;
      city?: string;
      owner_id?: string | null;
      tags?: unknown;
      socials?: unknown;
      lifecycle?: string;
    }
  ): Promise<ContactRow> {
    const existing = await contactsRepository.findById(contactId, tenantId);
    if (!existing) throw new NotFoundError("Contact not found");

    const updated = await contactsRepository.update(contactId, tenantId, {
      name: body.name,
      email: body.email,
      phone: normalizePhoneForStore(body.phone),
      company: body.company,
      account_id: body.account_id,
      title: body.title,
      city: body.city,
      owner_id: body.owner_id,
      tags: body.tags !== undefined ? parseStringArray(body.tags) : undefined,
      socials: body.socials !== undefined ? (parseSocials(body.socials) ?? {}) : undefined,
      lifecycle: asLifecycle(body.lifecycle),
    });
    if (!updated) throw new NotFoundError("Contact not found");

    engineService.audit(tenantId, actorId, "contact.updated", "contact", contactId, {});
    return updated;
  }

  async remove(tenantId: string, actorId: string, actorRole: string, contactId: string) {
    const contact = await contactsRepository.findById(contactId, tenantId);
    if (!contact) throw new NotFoundError("Contact not found");
    assertCanManageRecord(actorId, actorRole, contact.owner_id, "delete", "contact");

    // Same reason as leads: no FK ties these to `contacts`, so a delete without
    // this leaves identities pointing at a record that no longer exists.
    await engagementService.purgePerson(tenantId, { contactId });

    await contactsRepository.delete(contactId, tenantId);
    engineService.audit(tenantId, actorId, "contact.deleted", "contact", contactId, {});
    return { ok: true };
  }
}

export default new ContactsService();
