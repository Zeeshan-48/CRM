/**
 * Open CRM server SDK.
 *
 * Zero dependencies, Node 18+ (uses global fetch). Wraps the ingest API so an
 * integrating product does not have to reimplement idempotency keys, batching,
 * retries or the money-unit rules.
 *
 * Trusted events (payments, plan changes, subscription state) belong here, on
 * the server. The browser tracker handles page views and anonymous identity;
 * anything a customer could forge by opening devtools should never come from it.
 *
 *   import { OpenCRM } from "@open-crm/sdk";
 *
 *   const crm = new OpenCRM({ apiKey: process.env.CRM_SECRET_KEY! });
 *
 *   await crm.identify({ userId: "usr_8842", traits: { email: "priya@acme.example.com" } });
 *   await crm.track({ event: "checkout.completed", identity: { email: "priya@acme.example.com" },
 *                     properties: { value: 499900, currency: "INR" } });
 */

export interface OpenCRMOptions {
  /** A SECRET key (crm_sk_...). Never ship a secret key to a browser. */
  apiKey: string;
  /** Defaults to the production ingest URL. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Network-failure retries. Default 2 (three attempts total). */
  retries?: number;
  /**
   * Called when an event could not be delivered after retries. Default logs a
   * warning. Deliberately non-throwing: analytics must never take down the
   * request that produced it.
   */
  onError?: (error: Error, context: { path: string; attempt: number }) => void;
}

export interface Identity {
  /** The product's own user id. The strongest identifier. */
  userId?: string;
  email?: string;
  phone?: string;
  /** The tracker's anonymous id, to stitch pre-signup browsing. */
  anonymousId?: string;
}

export interface IdentifyInput {
  userId?: string;
  anonymousId?: string;
  traits?: {
    email?: string;
    phone?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    city?: string;
    plan?: string;
    [key: string]: unknown;
  };
}

export interface TrackInput {
  /** Dotted lower-case name, e.g. "checkout.completed". Unknown names are accepted. */
  event: string;
  identity: Identity;
  /** Defaults to now. Pass the real time when replaying a queue. */
  occurredAt?: Date | string;
  /**
   * Defaults to a generated key. Pass your own (an order id, a webhook event id)
   * so a redelivery is a no-op instead of a double count.
   */
  idempotencyKey?: string;
  /** Money goes in `value` as MINOR units (paise/cents), with `currency`. */
  properties?: Record<string, unknown>;
  /** The catalog item this event is about. */
  product?: { externalId?: string; name?: string };
  context?: { sessionId?: string; pageUrl?: string; referrer?: string };
  title?: string;
}

export interface LeadInput {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  city?: string;
  country?: string;
  source?: string;
  campaign?: string;
  notes?: string;
  tags?: string[];
  /** Makes the submission idempotent across retries. */
  externalId?: string;
  [key: string]: unknown;
}

export interface CatalogPrice {
  currency: string;
  /** MINOR units. 4999.00 INR is 499900. There is no `amount` field, by design. */
  amountMinor: number;
  compareAtMinor?: number;
  billingPeriod?: "ONE_TIME" | "MONTHLY" | "QUARTERLY" | "YEARLY";
  isDefault?: boolean;
}

export interface CatalogProduct {
  /** Your id for this product. The upsert key: stable forever. */
  externalId: string;
  name: string;
  description?: string;
  category?: string;
  sku?: string;
  /** Absolute URL. Relative paths are dropped rather than stored broken. */
  url?: string;
  media?: { thumbnail?: string; images?: string[] };
  /** Free-form. Rendered generically to agents. */
  attributes?: Record<string, unknown>;
  /** The bullets an agent reads out. Max 10. */
  highlights?: string[];
  status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
  sortOrder?: number;
  prices?: CatalogPrice[];
}

export interface CatalogOffer {
  /** Coupon code. Omit for an automatic offer with no code. */
  code?: string;
  name: string;
  description?: string;
  terms?: string;
  discountType: "PERCENT" | "FLAT";
  /** Percent 0-100, or MINOR units when FLAT. */
  discountValue: number;
  /** FLAT only. A PERCENT discount is currency-agnostic. */
  currency?: string;
  appliesTo?: { product_ids?: string[]; categories?: string[] };
  startsAt?: Date | string;
  endsAt?: Date | string;
  maxRedemptions?: number;
  status?: "ACTIVE" | "DISABLED";
}

export interface HealthReport {
  app: { key: string; name: string; environment: string; status: string };
  health: string;
  health_detail: string | null;
  last_event_at: string | null;
  events_24h: number;
  catalog: { products: number; offers: number };
  event_definitions: { total: number; needs_review: number };
  warnings: string[];
}

const DEFAULT_BASE_URL = "https://crm.example.com/api/v1/ingest";
const MAX_BATCH = 500;

const iso = (value: Date | string | undefined): string =>
  value instanceof Date
    ? value.toISOString()
    : typeof value === "string"
      ? value
      : new Date().toISOString();

const isoOrUndefined = (value: Date | string | undefined): string | undefined =>
  value === undefined ? undefined : iso(value);

/** Collision-resistant enough for an idempotency key without a uuid dependency. */
const generateKey = (): string =>
  `sdk_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;

export class OpenCRMError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = "OpenCRMError";
  }
}

export class OpenCRM {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly onError: NonNullable<OpenCRMOptions["onError"]>;

  constructor(options: OpenCRMOptions) {
    if (!options?.apiKey) throw new Error("OpenCRM: apiKey is required");
    if (options.apiKey.startsWith("crm_pk_")) {
      // A publishable key would be rejected by every endpoint this SDK calls
      // except events. Failing here is far clearer than a 403 at 3am.
      throw new Error(
        "OpenCRM: that is a publishable (browser) key. The server SDK needs a secret key (crm_sk_)."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.retries = Math.max(0, options.retries ?? 2);
    this.onError =
      options.onError ??
      ((error, ctx) => {
        console.warn(`[open-crm] ${ctx.path} failed after ${ctx.attempt} attempt(s): ${error.message}`);
      });
  }

  // ---- Transport ----

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    let lastError: Error = new Error("request failed");

    for (let attempt = 1; attempt <= this.retries + 1; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            "User-Agent": "open-crm-sdk/0.1",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        const text = await res.text();
        let parsed: unknown = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = text;
        }

        if (res.ok) {
          const envelope = parsed as { data?: T } | null;
          return (envelope && typeof envelope === "object" && "data" in envelope
            ? envelope.data
            : parsed) as T;
        }

        const envelope = parsed as { error?: { message?: string }; message?: string } | null;
        const message =
          envelope?.error?.message ?? envelope?.message ?? `HTTP ${res.status}`;

        // 4xx means the payload is wrong. Retrying sends the same wrong payload,
        // so fail immediately with the server's own explanation.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw new OpenCRMError(message, res.status, parsed);
        }
        lastError = new OpenCRMError(message, res.status, parsed);
      } catch (err) {
        if (err instanceof OpenCRMError) throw err;
        lastError = err instanceof Error ? err : new Error(String(err));
      } finally {
        clearTimeout(timer);
      }

      if (attempt <= this.retries) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      }
    }

    throw lastError;
  }

  /** Fire-and-forget wrapper: never throws, so analytics cannot break a request. */
  private safe<T>(path: string, method: string, body?: unknown): Promise<T | null> {
    return this.request<T>(path, method, body).catch((err: Error) => {
      this.onError(err, { path, attempt: this.retries + 1 });
      return null;
    });
  }

  // ---- Identity ----

  /**
   * Binds an identity to a person and claims everything they did anonymously
   * beforehand. Call it the moment someone signs up or logs in.
   */
  async identify(input: IdentifyInput): Promise<{ leadId: string | null; backfilled: number } | null> {
    return this.safe("/identify", "POST", {
      user_id: input.userId,
      anonymous_id: input.anonymousId,
      traits: input.traits ?? {},
    });
  }

  // ---- Events ----

  private toEventPayload(input: TrackInput): Record<string, unknown> {
    return {
      event: input.event,
      occurred_at: iso(input.occurredAt),
      idempotency_key: input.idempotencyKey ?? generateKey(),
      title: input.title,
      identity: {
        user_id: input.identity.userId,
        email: input.identity.email,
        phone: input.identity.phone,
        anonymous_id: input.identity.anonymousId,
      },
      product: input.product
        ? { external_id: input.product.externalId, name: input.product.name }
        : undefined,
      properties: input.properties ?? {},
      context: input.context
        ? {
            session_id: input.context.sessionId,
            page_url: input.context.pageUrl,
            referrer: input.context.referrer,
          }
        : undefined,
    };
  }

  /** Records one event. Never throws. */
  async track(input: TrackInput): Promise<{ eventId: string | null; leadId: string | null } | null> {
    return this.safe("/events", "POST", this.toEventPayload(input));
  }

  /**
   * Records many events. Automatically chunked, and per-event fault isolated
   * server-side: one bad event does not reject the batch.
   */
  async trackBatch(inputs: TrackInput[]): Promise<{ recorded: number; rejected: number }> {
    const totals = { recorded: 0, rejected: 0 };
    for (let i = 0; i < inputs.length; i += MAX_BATCH) {
      const chunk = inputs.slice(i, i + MAX_BATCH);
      const result = await this.safe<{ recorded: number; rejected: number }>("/events/batch", "POST", {
        events: chunk.map((input) => this.toEventPayload(input)),
      });
      if (result) {
        totals.recorded += result.recorded ?? 0;
        totals.rejected += result.rejected ?? 0;
      } else {
        totals.rejected += chunk.length;
      }
    }
    return totals;
  }

  // ---- Leads ----

  /**
   * Submits a lead. Throws on a bad payload, because a dropped lead is a lost
   * sale and the caller needs to know.
   */
  async captureLead(input: LeadInput): Promise<{ leadId: string | null; deduped: boolean }> {
    const { externalId, ...rest } = input;
    return this.request("/leads", "POST", { ...rest, external_id: externalId });
  }

  // ---- Catalog ----

  /**
   * Publishes the catalog.
   *
   * `mode: "REPLACE"` archives products absent from the payload. It never
   * deletes them, so deal line items and event history stay intact even after a
   * bad sync. Send at most 500 products per call.
   */
  async syncCatalog(
    products: CatalogProduct[],
    mode: "UPSERT" | "REPLACE" = "UPSERT"
  ): Promise<{ created: number; updated: number; archived: number }> {
    return this.request("/catalog", "PUT", {
      mode,
      products: products.map((p) => ({
        external_id: p.externalId,
        name: p.name,
        description: p.description,
        category: p.category,
        sku: p.sku,
        url: p.url,
        media: p.media,
        attributes: p.attributes,
        highlights: p.highlights,
        status: p.status,
        sort_order: p.sortOrder,
        prices: p.prices?.map((price) => ({
          currency: price.currency,
          amount_minor: price.amountMinor,
          compare_at_minor: price.compareAtMinor,
          billing_period: price.billingPeriod,
          is_default: price.isDefault,
        })),
      })),
    });
  }

  /** Publishes offers and coupon codes. */
  async syncOffers(offers: CatalogOffer[]): Promise<{ created: number; updated: number }> {
    return this.request("/catalog/offers", "PUT", {
      offers: offers.map((o) => ({
        code: o.code,
        name: o.name,
        description: o.description,
        terms: o.terms,
        discount_type: o.discountType,
        discount_value: o.discountValue,
        currency: o.currency,
        applies_to: o.appliesTo,
        starts_at: isoOrUndefined(o.startsAt),
        ends_at: isoOrUndefined(o.endsAt),
        max_redemptions: o.maxRedemptions,
        status: o.status,
      })),
    });
  }

  // ---- Diagnostics ----

  /**
   * Answers "is my integration working?" without anyone reading a log.
   * Worth wiring into your own health check while you build.
   */
  async health(): Promise<HealthReport> {
    return this.request("/health", "GET");
  }
}

export default OpenCRM;
