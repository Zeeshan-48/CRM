/**
 * Demo data for the product-integration platform (one connected product, its
 * catalog, its event vocabulary, and a believable engagement story per person).
 *
 * Kept out of seed.ts because it is the one part of the seed that has to tell a
 * *story* rather than fill tables: the whole point of the feature is that an agent
 * opening a lead sees "visited pricing three times, then abandoned a checkout
 * worth ₹49,999", and that is only visible if the seeded events actually line up
 * into that shape. Random rows would populate the panels and demonstrate nothing.
 *
 * Called per tenant from seedTenant().
 */

import { ulid } from "ulid";
import type { Kysely } from "kysely";
import type { DB } from "../src/db/types";
import { SEMANTIC_EVENTS } from "../src/constants/semantic-events.const";
import type { AppCapabilities } from "../src/constants/connected-apps.const";
import type { TopProduct, UsageBag } from "../src/services/engagement-fold";
import type { IntentReason } from "../src/services/ai/intent";

// The JSON columns on engagement_profiles are written at runtime by
// services/engagement-fold and services/engagement.service. Seeding a DIFFERENT
// shape produces demo data that renders wrong in ways no test catches: bare
// strings in `intent_reasons` blanked the IntentMeter rows, and a `top_products`
// entry without `name` rendered "Untitled". Both shipped and were only caught by
// looking at the page. These helpers exist so the compiler catches the next one.
const topProducts = (rows: TopProduct[]): string => JSON.stringify(rows);
const intentReasons = (rows: IntentReason[]): string => JSON.stringify(rows);
const usageBag = (bag: UsageBag): string => JSON.stringify(bag);
// engagement-fold builds this on checkout.started; note product_id is SINGULAR.
interface AbandonedCart {
  product_id: string | null;
  external_id: string | null;
  name: string | null;
  value_minor: number | null;
  currency: string | null;
  coupon: string | null;
}
const abandonedCart = (cart: AbandonedCart): string => JSON.stringify(cart);

interface SeedPerson {
  id: string;
  name: string;
  email: string | null;
}

interface SeedArgs {
  db: Kysely<DB>;
  tenantId: string;
  /** Leads to give a product story to. The first few get the richest history. */
  leads: SeedPerson[];
  /** Converted people; they get a paying-customer profile. */
  contacts: SeedPerson[];
  /** Shapes the catalog: courses for the EdTech tenant, licences for the other. */
  edtech: boolean;
}

const daysAgo = (d: number): Date => new Date(Date.now() - d * 86400000);
const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600000);

interface SeedPrice {
  amount_minor: number;
  compare_at_minor?: number;
  billing_period: string;
}

interface SeedCatalogItem {
  external_id: string;
  name: string;
  category: string;
  description: string;
  highlights: string[];
  attributes: Record<string, unknown>;
  prices: SeedPrice[];
}

const EDTECH_CATALOG: SeedCatalogItem[] = [
  {
    external_id: "course_ai_bootcamp",
    name: "AI Engineering Bootcamp",
    category: "Bootcamp",
    description:
      "16-week cohort covering LLM application development, RAG and evaluation. Includes placement support.",
    highlights: ["16 weeks, live", "1:1 mentorship", "Placement support", "EMI available"],
    attributes: { level: "Advanced", duration_weeks: 16, mode: "Live cohort", language: "English" },
    prices: [
      { amount_minor: 12999900, compare_at_minor: 15999900, billing_period: "ONE_TIME" },
      { amount_minor: 1199900, billing_period: "MONTHLY" },
    ],
  },
  {
    external_id: "course_data_analytics",
    name: "Data Analytics Professional",
    category: "Certification",
    description: "Self-paced SQL, Python and dashboarding track with a capstone project.",
    highlights: ["Self-paced", "Capstone project", "Certificate"],
    attributes: { level: "Intermediate", duration_weeks: 10, mode: "Self-paced" },
    prices: [{ amount_minor: 4999900, compare_at_minor: 6999900, billing_period: "ONE_TIME" }],
  },
  {
    external_id: "course_interview_prep",
    name: "Interview Prep Intensive",
    category: "Short course",
    description: "Four weeks of mock interviews and system-design practice.",
    highlights: ["4 weeks", "Mock interviews", "Resume review"],
    attributes: { level: "All levels", duration_weeks: 4, mode: "Live cohort" },
    prices: [{ amount_minor: 1499900, billing_period: "ONE_TIME" }],
  },
];

const SAAS_CATALOG: SeedCatalogItem[] = [
  {
    external_id: "plan_team",
    name: "Team Plan",
    category: "Subscription",
    description: "Up to 25 seats, full workflow automation and the reporting suite.",
    highlights: ["25 seats", "Automation", "Priority support"],
    attributes: { seats: 25, support: "Priority", sso: false },
    prices: [
      { amount_minor: 999900, billing_period: "MONTHLY" },
      { amount_minor: 9999900, compare_at_minor: 11998800, billing_period: "YEARLY" },
    ],
  },
  {
    external_id: "plan_business",
    name: "Business Plan",
    category: "Subscription",
    description: "Unlimited seats, SSO, audit log and a dedicated success manager.",
    highlights: ["Unlimited seats", "SSO + audit log", "Success manager"],
    attributes: { seats: 0, support: "Dedicated", sso: true },
    prices: [
      { amount_minor: 2999900, billing_period: "MONTHLY" },
      { amount_minor: 29999900, billing_period: "YEARLY" },
    ],
  },
  {
    external_id: "addon_extra_storage",
    name: "Extra Storage (100 GB)",
    category: "Add-on",
    description: "Additional document storage, billed monthly.",
    highlights: ["100 GB", "Cancel anytime"],
    attributes: { storage_gb: 100 },
    prices: [{ amount_minor: 149900, billing_period: "MONTHLY" }],
  },
];

export async function seedProductIntegration({
  db,
  tenantId,
  leads,
  contacts,
  edtech,
}: SeedArgs): Promise<void> {
  const t = new Date();
  const appId = ulid();
  const appName = edtech ? "Northwind Academy" : "Acme Cloud";
  const productUrl = edtech ? "https://northwind.example.com" : "https://app.acme.example.com";

  // ---- The connected product ----
  await db
    .insertInto("connected_apps")
    .values({
      id: appId,
      tenant_id: tenantId,
      key: edtech ? "northwind-academy" : "acme-cloud",
      name: appName,
      description: "Live product pushing its catalog and user activity into the CRM.",
      logo_url: null,
      product_url: productUrl,
      status: "ACTIVE",
      environment: "LIVE",
      // Typed so a new capability cannot be silently omitted. `deeplink` is true
      // because the seeded products carry a `url` the agent panel links out to.
      capabilities: JSON.stringify({
        catalog: true,
        events: true,
        identity: true,
        deeplink: true,
        outbound: false,
        actions: false,
      } satisfies AppCapabilities),
      catalog_mode: "PUSH",
      catalog_pull_url: null,
      last_catalog_sync_at: hoursAgo(3),
      actions_url: null,
      actions_secret: null,
      actions_catalog: null,
      allowed_origins: JSON.stringify([productUrl]),
      last_event_at: hoursAgo(1),
      health: "OK",
      last_error: null,
      created_at: daysAgo(45),
      updated_at: t,
    })
    .execute();

  // ---- Its event vocabulary ----
  // The full semantic set, so the Events tab and the intent weights are populated
  // exactly as they would be after a real first connect.
  await db
    .insertInto("app_event_definitions")
    .values(
      SEMANTIC_EVENTS.map((e) => ({
        id: ulid(),
        tenant_id: tenantId,
        app_id: appId,
        name: e.name,
        label: e.label,
        description: e.description,
        category: e.category,
        icon: e.icon,
        intent_weight: e.intent_weight,
        is_high_intent: e.is_high_intent,
        property_schema: null,
        review_status: "ACTIVE",
        auto_registered: false,
        event_count: 0,
        last_seen_at: null,
        created_at: daysAgo(45),
        updated_at: t,
      }))
    )
    .execute();

  // One auto-registered name awaiting review, because that is the normal steady
  // state of a live integration and the review queue should not look broken when
  // it is empty for the wrong reason.
  await db
    .insertInto("app_event_definitions")
    .values({
      id: ulid(),
      tenant_id: tenantId,
      app_id: appId,
      name: edtech ? "lesson.bookmarked" : "report.exported",
      label: edtech ? "Lesson bookmarked" : "Report exported",
      description: "Auto-registered from an incoming event. Set its intent weight to use it in scoring.",
      category: "ACTION",
      icon: null,
      intent_weight: 0,
      is_high_intent: false,
      property_schema: null,
      review_status: "NEEDS_REVIEW",
      auto_registered: true,
      event_count: 14,
      last_seen_at: hoursAgo(6),
      created_at: daysAgo(2),
      updated_at: t,
    })
    .execute();

  // ---- Catalog ----
  const catalog = edtech ? EDTECH_CATALOG : SAAS_CATALOG;
  const productIds: string[] = [];
  for (let i = 0; i < catalog.length; i++) {
    const spec = catalog[i];
    const productId = ulid();
    productIds.push(productId);
    await db
      .insertInto("products")
      .values({
        id: productId,
        tenant_id: tenantId,
        app_id: appId,
        external_id: spec.external_id,
        sku: spec.external_id.toUpperCase(),
        name: spec.name,
        description: spec.description,
        category: spec.category,
        family: null,
        url: `${productUrl}/${spec.external_id.replace(/_/g, "-")}`,
        media: null,
        attributes: JSON.stringify(spec.attributes),
        highlights: JSON.stringify(spec.highlights),
        status: "ACTIVE",
        source: "SYNCED",
        sort_order: i,
        total_sales: [23, 11, 7][i] ?? 0,
        synced_at: hoursAgo(3),
        created_at: daysAgo(45),
        updated_at: t,
      })
      .execute();

    await db
      .insertInto("product_prices")
      .values(
        spec.prices.map((p, pi) => ({
          id: ulid(),
          tenant_id: tenantId,
          product_id: productId,
          price_book: "STANDARD",
          currency: "INR",
          amount_minor: p.amount_minor,
          compare_at_minor: p.compare_at_minor ?? null,
          billing_period: p.billing_period,
          is_default: pi === 0,
          created_at: daysAgo(45),
          updated_at: t,
        }))
      )
      .execute();
  }

  // ---- Offers: one live coupon, one expired ----
  // The expired one matters: it proves the agent panel hides offers it must not
  // quote, which is the difference between a useful panel and a liability.
  await db
    .insertInto("product_offers")
    .values([
      {
        id: ulid(),
        tenant_id: tenantId,
        app_id: appId,
        product_id: null,
        code: "SAVE20",
        name: "20% off this month",
        description: "Limited-time discount across the catalog.",
        terms: "New customers only. Cannot be combined with other offers.",
        discount_type: "PERCENT",
        discount_value: 20,
        currency: null,
        applies_to: JSON.stringify({ product_ids: [], categories: [] }),
        starts_at: daysAgo(10),
        ends_at: new Date(Date.now() + 20 * 86400000),
        max_redemptions: 200,
        redemptions_used: 41,
        status: "ACTIVE",
        created_at: daysAgo(10),
        updated_at: t,
      },
      {
        id: ulid(),
        tenant_id: tenantId,
        app_id: appId,
        product_id: productIds[0] ?? null,
        code: "EARLYBIRD",
        name: "Early bird (ended)",
        description: "Cohort early-bird pricing.",
        terms: "Applied to the previous cohort only.",
        discount_type: "FLAT",
        discount_value: 500000,
        currency: "INR",
        applies_to: JSON.stringify({ product_ids: [], categories: [] }),
        starts_at: daysAgo(60),
        ends_at: daysAgo(15),
        max_redemptions: 50,
        redemptions_used: 50,
        status: "EXPIRED",
        created_at: daysAgo(60),
        updated_at: t,
      },
    ])
    .execute();

  // ---- Per-person stories ----
  //
  // Three shapes, so every panel state is represented in the demo:
  //   HOT, repeat pricing views then an abandoned checkout (the call-now case)
  //   WARM, signed up, poking around, no buying signal yet
  //   PAYING- a converted contact on an active plan
  const events: Array<Record<string, unknown>> = [];
  const identities: Array<Record<string, unknown>> = [];
  const profiles: Array<Record<string, unknown>> = [];

  const pushEvent = (row: {
    leadId?: string | null;
    contactId?: string | null;
    event: string;
    title: string;
    at: Date;
    productId?: string | null;
    pageUrl?: string | null;
    sessionId?: string;
    valueMinor?: number | null;
  }) => {
    events.push({
      id: ulid(),
      tenant_id: tenantId,
      api_key_id: null,
      lead_id: row.leadId ?? null,
      contact_id: row.contactId ?? null,
      event: row.event,
      title: row.title,
      status: "RECORDED",
      occurred_at: row.at,
      idempotency_key: `seed-${ulid()}`,
      payload: JSON.stringify({ properties: {} }),
      error: null,
      created_at: row.at,
      app_id: appId,
      product_id: row.productId ?? null,
      anonymous_id: null,
      session_id: row.sessionId ?? null,
      page_url: row.pageUrl ?? null,
      referrer: null,
      value_minor: row.valueMinor ?? null,
      currency: row.valueMinor ? "INR" : null,
    });
  };

  const pushIdentity = (person: SeedPerson, isContact: boolean, firstSeen: Date) => {
    if (!person.email) return;
    identities.push({
      id: ulid(),
      tenant_id: tenantId,
      app_id: appId,
      identity_type: "EMAIL",
      identity_value: person.email.toLowerCase(),
      lead_id: isContact ? null : person.id,
      contact_id: isContact ? person.id : null,
      first_seen_at: firstSeen,
      last_seen_at: hoursAgo(2),
      created_at: firstSeen,
    });
  };

  // -- HOT: the first two leads --
  const hotLeads = leads.slice(0, 2);
  hotLeads.forEach((lead, idx) => {
    const productId = productIds[idx % productIds.length];
    const firstSeen = daysAgo(9 - idx);
    const price = catalog[idx % catalog.length].prices[0].amount_minor;
    pushIdentity(lead, false, firstSeen);

    pushEvent({
      leadId: lead.id,
      event: "session.started",
      title: "Visited the site",
      at: firstSeen,
      pageUrl: `${productUrl}/`,
      sessionId: `sess-${idx}-a`,
    });
    // Repeat pricing views: one visit is curiosity, three in a week is a budget
    // conversation happening somewhere the CRM cannot see.
    for (let v = 0; v < 3; v++) {
      pushEvent({
        leadId: lead.id,
        event: "pricing.viewed",
        title: "Viewed pricing",
        at: daysAgo(6 - v - idx * 0.5),
        pageUrl: `${productUrl}/pricing`,
        sessionId: `sess-${idx}-${v}`,
      });
    }
    pushEvent({
      leadId: lead.id,
      event: "content.viewed",
      title: `Viewed ${catalog[idx % catalog.length].name}`,
      at: daysAgo(3),
      productId,
      pageUrl: `${productUrl}/${catalog[idx % catalog.length].external_id.replace(/_/g, "-")}`,
      sessionId: `sess-${idx}-c`,
    });
    pushEvent({
      leadId: lead.id,
      event: "checkout.started",
      title: "Started checkout",
      at: hoursAgo(30 + idx * 6),
      productId,
      pageUrl: `${productUrl}/checkout`,
      valueMinor: price,
      sessionId: `sess-${idx}-d`,
    });
    pushEvent({
      leadId: lead.id,
      event: "checkout.abandoned",
      title: "Abandoned checkout",
      at: hoursAgo(29 + idx * 6),
      productId,
      pageUrl: `${productUrl}/checkout`,
      valueMinor: price,
      sessionId: `sess-${idx}-d`,
    });

    profiles.push({
      id: ulid(),
      tenant_id: tenantId,
      app_id: appId,
      lead_id: lead.id,
      contact_id: null,
      lifecycle_stage: "SIGNED_UP",
      plan_name: null,
      plan_status: null,
      mrr_minor: null,
      currency: "INR",
      first_seen_at: firstSeen,
      last_seen_at: hoursAgo(29 + idx * 6),
      signup_at: daysAgo(7 - idx),
      trial_ends_at: null,
      sessions_30d: 6 - idx,
      events_30d: 7,
      page_views_30d: 12 - idx,
      active_days_30d: 5 - idx,
      intent_score: 84 - idx * 6,
      intent_band: "HOT",
      // Shape must match what services/engagement.service writes on recompute:
      // { label, weight, count }. Bare strings leave `reason.label` undefined,
      // which renders an empty bullet and warns about a missing React key.
      intent_reasons: intentReasons([
        { label: "Abandoned checkout", weight: 30, count: 1 },
        { label: "Viewed pricing", weight: 18, count: 3 },
        { label: `Looked at ${catalog[idx % catalog.length].name}`, weight: 8, count: 1 },
      ]),
      checkout_abandoned_at: hoursAgo(29 + idx * 6),
      abandoned_cart: abandonedCart({
        product_id: productId,
        external_id: catalog[idx % catalog.length].external_id,
        name: catalog[idx % catalog.length].name,
        value_minor: price,
        currency: "INR",
        coupon: null,
      }),
      // Full TopProduct shape, as services/engagement-fold writes it. Omitting
      // `name` here made the "Most viewed" row read "Untitled".
      top_products: topProducts([
        {
          product_id: productId,
          external_id: catalog[idx % catalog.length].external_id,
          name: catalog[idx % catalog.length].name,
          views: 4,
          last_at: daysAgo(3).toISOString(),
        },
      ]),
      usage: usageBag({
        counts: { "pricing.viewed": 3, "checkout.started": 1 },
        reported: edtech
          ? { lessons_completed: 2, quizzes_attempted: 1 }
          : { reports_run: 3, seats_used: 1 },
      }),
      created_at: firstSeen,
      updated_at: t,
    });
  });

  // -- WARM: the next three leads --
  leads.slice(2, 5).forEach((lead, idx) => {
    const firstSeen = daysAgo(14 - idx);
    const productId = productIds[(idx + 1) % productIds.length];
    pushIdentity(lead, false, firstSeen);

    pushEvent({
      leadId: lead.id,
      event: "signup.completed",
      title: "Signed up",
      at: firstSeen,
      pageUrl: `${productUrl}/signup`,
      sessionId: `warm-${idx}`,
    });
    pushEvent({
      leadId: lead.id,
      event: "content.viewed",
      title: `Viewed ${catalog[(idx + 1) % catalog.length].name}`,
      at: daysAgo(8 - idx),
      productId,
      pageUrl: `${productUrl}/catalog`,
      sessionId: `warm-${idx}`,
    });
    pushEvent({
      leadId: lead.id,
      event: "feature.used",
      title: edtech ? "Started a lesson" : "Ran a report",
      at: daysAgo(5 - idx),
      sessionId: `warm-${idx}-b`,
    });

    profiles.push({
      id: ulid(),
      tenant_id: tenantId,
      app_id: appId,
      lead_id: lead.id,
      contact_id: null,
      lifecycle_stage: "ACTIVE",
      plan_name: null,
      plan_status: null,
      mrr_minor: null,
      currency: "INR",
      first_seen_at: firstSeen,
      last_seen_at: daysAgo(5 - idx),
      signup_at: firstSeen,
      trial_ends_at: null,
      sessions_30d: 3,
      events_30d: 3,
      page_views_30d: 5,
      active_days_30d: 3,
      intent_score: 45 - idx * 5,
      intent_band: "WARM",
      intent_reasons: intentReasons([
        { label: "Used a feature", weight: 6, count: 1 },
        { label: "Signed up", weight: 10, count: 1 },
      ]),
      checkout_abandoned_at: null,
      abandoned_cart: null,
      top_products: topProducts([
        {
          product_id: productId,
          external_id: catalog[(idx + 1) % catalog.length].external_id,
          name: catalog[(idx + 1) % catalog.length].name,
          views: 1,
          last_at: daysAgo(8 - idx).toISOString(),
        },
      ]),
      usage: usageBag({
        counts: { "feature.used": 1, "content.viewed": 1 },
        reported: edtech
          ? { lessons_completed: 6, quizzes_attempted: 3 }
          : { reports_run: 9, seats_used: 2 },
      }),
      created_at: firstSeen,
      updated_at: t,
    });
  });

  // -- PAYING: the first two contacts --
  contacts.slice(0, 2).forEach((contact, idx) => {
    const firstSeen = daysAgo(120 - idx * 10);
    const productId = productIds[idx % productIds.length];
    const mrr = edtech ? 1199900 : idx === 0 ? 999900 : 2999900;
    pushIdentity(contact, true, firstSeen);

    pushEvent({
      contactId: contact.id,
      event: "checkout.completed",
      title: "Purchased",
      at: daysAgo(100 - idx * 10),
      productId,
      valueMinor: mrr,
      pageUrl: `${productUrl}/checkout/success`,
      sessionId: `pay-${idx}`,
    });
    pushEvent({
      contactId: contact.id,
      event: "subscription.renewed",
      title: "Subscription renewed",
      at: daysAgo(10),
      productId,
      valueMinor: mrr,
      sessionId: `pay-${idx}-r`,
    });
    pushEvent({
      contactId: contact.id,
      event: "feature.used",
      title: edtech ? "Completed a module" : "Invited a teammate",
      at: hoursAgo(20 + idx * 5),
      sessionId: `pay-${idx}-f`,
    });

    profiles.push({
      id: ulid(),
      tenant_id: tenantId,
      app_id: appId,
      lead_id: null,
      contact_id: contact.id,
      lifecycle_stage: "PAYING",
      plan_name: edtech ? "AI Bootcamp (monthly)" : idx === 0 ? "Team Plan" : "Business Plan",
      plan_status: "active",
      mrr_minor: mrr,
      currency: "INR",
      first_seen_at: firstSeen,
      last_seen_at: hoursAgo(20 + idx * 5),
      signup_at: firstSeen,
      trial_ends_at: null,
      sessions_30d: 18 - idx * 3,
      events_30d: 42 - idx * 7,
      page_views_30d: 96 - idx * 12,
      active_days_30d: 14 - idx * 2,
      intent_score: 30,
      intent_band: "COLD",
      intent_reasons: intentReasons([
        { label: "Subscription renewed", weight: 5, count: 1 },
        { label: "Used a feature", weight: 6, count: 1 },
      ]),
      checkout_abandoned_at: null,
      abandoned_cart: null,
      top_products: topProducts([
        {
          product_id: productId,
          external_id: catalog[idx % catalog.length].external_id,
          name: catalog[idx % catalog.length].name,
          views: 8,
          last_at: daysAgo(10).toISOString(),
        },
      ]),
      usage: usageBag({
        counts: { "subscription.renewed": 1, "feature.used": 1 },
        reported: edtech
          ? { lessons_completed: 48, quizzes_attempted: 22, certificates: 1 }
          : { reports_run: 130, seats_used: 12, api_calls: 4200 },
      }),
      created_at: firstSeen,
      updated_at: t,
    });
  });

  if (events.length) {
    await db.insertInto("activity_events").values(events as never).execute();
  }
  if (identities.length) {
    await db.insertInto("app_identities").values(identities as never).execute();
  }
  if (profiles.length) {
    await db.insertInto("engagement_profiles").values(profiles as never).execute();
  }

  // Event definition counters, so the Events tab shows real volume rather than
  // zeroes next to events that plainly have history.
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.event as string, (counts.get(e.event as string) ?? 0) + 1);
  for (const [name, count] of counts) {
    await db
      .updateTable("app_event_definitions")
      .set({ event_count: count, last_seen_at: hoursAgo(1), updated_at: t })
      .where("tenant_id", "=", tenantId)
      .where("app_id", "=", appId)
      .where("name", "=", name)
      .execute();
  }

  console.log(
    `[seed]   product integration: ${appName}, ${catalog.length} products, ` +
      `${events.length} events, ${profiles.length} engagement profiles`
  );
}
