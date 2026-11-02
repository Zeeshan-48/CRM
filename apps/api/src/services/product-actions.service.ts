import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";
import connectedAppsRepository from "../repositories/connected-apps.repository";
import { decryptSecret } from "../utils/crypto";
import { assertSafeUrl } from "../utils/http-guard";
import logger from "../utils/logger";
import { DELIVERY_HEADER, EVENT_HEADER, SIGNATURE_HEADER, signPayload } from "../utils/webhook-signature";
import engineService from "./engine.service";

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_CHARS = 2000;

export interface ActionDefinition {
  key: string;
  label: string;
  description?: string;
  /** { paramName: { type, label, default, required } }, rendered as a form. */
  params_schema?: Record<string, unknown>;
  /** Show a confirmation step before firing. Default true for safety. */
  confirm?: boolean;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  data?: unknown;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/**
 * Parses the action catalogue a product declared. Unknown shapes are dropped
 * rather than rejected, so a malformed entry hides one button instead of
 * breaking the whole panel.
 */
export const parseActionCatalog = (value: unknown): ActionDefinition[] => {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): ActionDefinition | null => {
      const o = asObject(entry);
      const key = typeof o.key === "string" ? o.key.trim() : "";
      const label = typeof o.label === "string" ? o.label.trim() : "";
      if (!key || !label) return null;
      return {
        key: key.slice(0, 60),
        label: label.slice(0, 80),
        description: typeof o.description === "string" ? o.description.slice(0, 300) : undefined,
        params_schema: o.params_schema ? asObject(o.params_schema) : undefined,
        // Default to requiring confirmation. An action mutates a real customer's
        // account in another system; an accidental click should not be enough.
        confirm: o.confirm !== false,
      };
    })
    .filter((a): a is ActionDefinition => a !== null)
    .slice(0, 25);
};

/**
 * The CRM calling INTO the product: issue a coupon, extend a trial, unlock a
 * feature, resend an invoice.
 *
 * This is what makes the integration operational rather than read-only, and it
 * is the piece Salesforce does with External Services and Zoho with Connections.
 * Scoped down to what a sales agent actually needs: the product declares a
 * catalogue of actions, the CRM renders buttons, and the agent fires one without
 * leaving the record.
 */
class ProductActionsService {
  /** The actions an agent may fire for a connected product. */
  async listActions(tenantId: string, appId: string): Promise<ActionDefinition[]> {
    const app = await connectedAppsRepository.findById(appId, tenantId);
    if (!app) throw new NotFoundError("Connected product not found");
    if (!app.actions_url || !app.actions_secret) return [];
    return parseActionCatalog(app.actions_catalog);
  }

  /** Every action across every connected product, for a record's action menu. */
  async listAllActions(tenantId: string) {
    const apps = await connectedAppsRepository.list(tenantId);
    return apps
      .filter((app) => app.status === "ACTIVE" && app.actions_url && app.actions_secret)
      .map((app) => ({
        app_id: app.id,
        app_name: app.name,
        actions: parseActionCatalog(app.actions_catalog),
      }))
      .filter((entry) => entry.actions.length > 0);
  }

  /**
   * Fires one action and logs the outcome as an activity on the record, so the
   * next agent to open it can see that a trial was extended and by whom.
   *
   * Sent INLINE rather than queued: an agent is watching and needs the product's
   * actual answer, including its error message.
   */
  async invoke(
    tenantId: string,
    actorId: string,
    appId: string,
    actionKey: string,
    body: { params?: Record<string, unknown>; lead_id?: string; contact_id?: string }
  ): Promise<ActionResult> {
    const app = await connectedAppsRepository.findById(appId, tenantId);
    if (!app) throw new NotFoundError("Connected product not found");
    if (app.status !== "ACTIVE") {
      throw new ForbiddenError("This connected product is not active");
    }
    if (!app.actions_url || !app.actions_secret) {
      throw new BadRequestError("This product has no actions endpoint configured");
    }

    const catalog = parseActionCatalog(app.actions_catalog);
    const action = catalog.find((a) => a.key === actionKey);
    if (!action) {
      // Only declared actions may be fired. Without this, the endpoint would be
      // an arbitrary proxy into the product's API.
      throw new NotFoundError(`"${actionKey}" is not an action this product offers`);
    }

    // Identity is resolved server-side from the CRM record, never taken from the
    // client, so an agent cannot fire an action against someone else's account.
    const person = await this.resolvePerson(tenantId, body.lead_id, body.contact_id);

    const requestId = ulid();
    const payload = {
      id: requestId,
      action: action.key,
      requested_at: new Date().toISOString(),
      params: asObject(body.params),
      subject: person,
    };
    const serialized = JSON.stringify(payload);

    let result: ActionResult;
    try {
      // Re-validated per call, not once at configuration time: a host that
      // resolved publicly yesterday can point somewhere private today.
      await assertSafeUrl(app.actions_url);

      const secret = decryptSecret(app.actions_secret);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(app.actions_url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [EVENT_HEADER]: `action.${action.key}`,
            [DELIVERY_HEADER]: requestId,
            [SIGNATURE_HEADER]: signPayload(secret, serialized),
            "User-Agent": "OpenCRM-Actions/1.0",
          },
          body: serialized,
          redirect: "error",
          signal: controller.signal,
        });
        const text = (await res.text()).slice(0, MAX_RESPONSE_CHARS);
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const parsedObj = asObject(parsed);

        result = res.ok
          ? {
              ok: true,
              // Prefer the product's own wording: it knows what it just did.
              message:
                typeof parsedObj.message === "string" ? parsedObj.message : `${action.label} done`,
              data: parsed ?? undefined,
            }
          : {
              ok: false,
              message:
                typeof parsedObj.message === "string"
                  ? parsedObj.message
                  : `${action.label} failed (HTTP ${res.status})`,
            };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      result = {
        ok: false,
        message: `Could not reach ${app.name}: ${err instanceof Error ? err.message : "request failed"}`,
      };
    }

    await this.logActivity(tenantId, actorId, app.name, action.label, result, person);
    engineService.audit(tenantId, actorId, "product_action.invoked", "connected_app", appId, {
      action: action.key,
      ok: result.ok,
    });

    return result;
  }

  private async resolvePerson(
    tenantId: string,
    leadId?: string,
    contactId?: string
  ): Promise<Record<string, unknown>> {
    if (contactId) {
      const contact = await db
        .selectFrom("contacts")
        .select(["id", "name", "email", "phone"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", contactId)
        .executeTakeFirst();
      if (!contact) throw new NotFoundError("Contact not found");
      return { type: "contact", ...contact };
    }
    if (leadId) {
      const lead = await db
        .selectFrom("leads")
        .select(["id", "name", "email", "phone", "external_id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", leadId)
        .executeTakeFirst();
      if (!lead) throw new NotFoundError("Lead not found");
      return { type: "lead", ...lead };
    }
    throw new BadRequestError("An action needs a lead_id or contact_id");
  }

  /**
   * Records what happened on the CRM timeline. Best-effort: the action already
   * ran in the other system, so a logging failure must not report it as failed.
   */
  private async logActivity(
    tenantId: string,
    actorId: string,
    appName: string,
    actionLabel: string,
    result: ActionResult,
    person: Record<string, unknown>
  ): Promise<void> {
    try {
      const now = new Date();
      await db
        .insertInto("activities")
        .values({
          id: ulid(),
          tenant_id: tenantId,
          type: "NOTE",
          subject: `${actionLabel} on ${appName}`,
          notes: result.ok ? result.message : `Failed: ${result.message}`,
          owner_id: actorId,
          lead_id: person.type === "lead" ? (person.id as string) : null,
          contact_id: person.type === "contact" ? (person.id as string) : null,
          deal_id: null,
          ai_generated: false,
          created_at: now,
          updated_at: now,
        })
        .execute();
    } catch (err) {
      logger.warn(`product action activity log failed: ${String(err)}`);
    }
  }
}

export default new ProductActionsService();
