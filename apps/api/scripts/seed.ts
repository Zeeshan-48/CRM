/**
 * Demo seed: plans, an operator, and two fictional workspaces full of data.
 *   pnpm demo:seed            seeds only when the database is empty
 *   pnpm demo:seed --force    wipes CRM data and reseeds
 *
 * Logins after seeding (every account uses DEMO_PASSWORD when it is set; the
 * fixed fallbacks below exist for local development and the test suite):
 *   maya@northwind.example.com / admin123   (Northwind Academy, ENTERPRISE)
 *   arjun@acme.example.com / admin123       (Acme Robotics, GROWTH)
 *   specialist roles use agent123, managers manager123
 *   operator: root@example.com / operator123
 *
 * Refuses to run when NODE_ENV=production.
 */
process.env.TZ = "UTC";

import crypto from "crypto";
import bcrypt from "bcrypt";
import { ulid } from "ulid";
import { sealSecret } from "../src/utils/crypto";

const demoPassword = (fallback: string): string => process.env.DEMO_PASSWORD || fallback;
import type { Selectable } from "kysely";
import { closeDB, db } from "../src/db/connection";
import type { DB } from "../src/db/types";
import { MODULES } from "../src/constants/modules.const";
import type { PlanRow } from "../src/repositories/operator/plans.repository";
import { planSnapshotSpecs } from "../src/services/operator/plan-snapshot";
import { DEAL_STAGES } from "../src/constants/deal-stages.const";
import { seedProductIntegration } from "./seed-product-integration";
import {
  dealHealth,
  scoreLead,
  sentiment,
  simulateVoiceCall,
  summarize,
  winProbability,
} from "../src/services/ai/heuristics";

const BCRYPT_ROUNDS = 12;
const now = () => new Date();
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);
const daysAhead = (d: number) => new Date(Date.now() + d * 86400000);

const PLANS = [
  {
    key: "STARTER",
    name: "Starter",
    description: "For small teams getting started with CRM basics",
    price_monthly: 0,
    modules: ["leads", "contacts", "deals", "activities", "calendar", "copilot", "kb"],
    limits: { seats: 3, leads: 500, ai_credits_monthly: 100 },
    sort_order: 0,
  },
  {
    key: "GROWTH",
    name: "Growth",
    description: "Full CRM with WhatsApp, automation and AI Copilot",
    price_monthly: 4999,
    modules: MODULES.filter((m) => m !== "agents"),
    limits: { seats: 25, leads: 100000, ai_credits_monthly: 5000, connected_apps: 3 },
    sort_order: 1,
  },
  {
    key: "ENTERPRISE",
    name: "Enterprise",
    description: "Everything in Growth plus autonomous AI agents",
    price_monthly: 19999,
    modules: [...MODULES],
    limits: { seats: 200, leads: 100000, ai_credits_monthly: 5000, connected_apps: 25 },
    sort_order: 2,
  },
];

async function wipe() {
  console.log("[seed] wiping existing data...");
  await db.deleteFrom("tenants").execute(); // cascades to all CRM tables (incl. subscriptions + platform_transactions)
  await db.deleteFrom("operator_audit_logs").execute();
  await db.deleteFrom("operator_users").execute();
  await db.deleteFrom("plan_gateway_refs").execute();
  await db.deleteFrom("platform_webhook_events").execute();
  await db.deleteFrom("plans").execute();
}

async function seedPlansAndOperator() {
  const t = now();
  for (const p of PLANS) {
    await db
      .insertInto("plans")
      .values({
        id: ulid(),
        key: p.key,
        name: p.name,
        description: p.description,
        price_monthly: p.price_monthly,
        currency: "INR",
        modules: JSON.stringify(p.modules),
        limits: JSON.stringify(p.limits),
        is_active: true,
        sort_order: p.sort_order,
        created_at: t,
        updated_at: t,
      })
      .execute();
  }

  // Platform-billing gateway plan refs (dev/simulate placeholders). Replace the
  // external ids with real Razorpay plan ids / Stripe price ids in production.
  // Amounts are in the smallest currency unit (paise) to match gateway payloads.
  for (const p of PLANS) {
    for (const gateway of ["RAZORPAY", "STRIPE"] as const) {
      await db
        .insertInto("plan_gateway_refs")
        .values({
          id: ulid(),
          plan_key: p.key,
          gateway,
          billing_interval: "MONTHLY",
          external_plan_id:
            gateway === "RAZORPAY"
              ? `rzp_plan_${p.key.toLowerCase()}`
              : `price_${p.key.toLowerCase()}`,
          amount: p.price_monthly * 100,
          currency: "INR",
          active: true,
          created_at: t,
          updated_at: t,
        })
        .onConflict((oc) =>
          oc.columns(["plan_key", "gateway", "billing_interval"]).doNothing()
        )
        .execute();
    }
  }

  await db
    .insertInto("operator_users")
    .values({
      id: ulid(),
      email: "root@example.com",
      name: "Platform Operator",
      password_hash: await bcrypt.hash(demoPassword("operator123"), BCRYPT_ROUNDS),
      role: "SUPERADMIN",
      status: "ACTIVE",
      created_at: t,
      updated_at: t,
    })
    .execute();
  console.log("[seed] plans + operator user created");
}

interface TenantSpec {
  slug: string;
  name: string;
  domain: string;
  industry: string;
  planKey: string;
  brandColor: string;
  emailDomain: string;
  edtech: boolean;
}

// Same rows the operator plane writes at onboarding (one shared function).
async function snapshotEntitlements(tenantId: string, planKey: string) {
  const plan = PLANS.find((p) => p.key === planKey)!;
  const t = now();
  const specs = planSnapshotSpecs({ modules: plan.modules, limits: plan.limits } as unknown as PlanRow);
  const rows = specs.map((spec) => ({
    id: ulid(),
    tenant_id: tenantId,
    ...spec,
    source: "PLAN" as const,
    created_at: t,
    updated_at: t,
  }));
  await db.insertInto("tenant_entitlements").values(rows).execute();
}

async function seedTenant(spec: TenantSpec) {
  console.log(`[seed] tenant ${spec.name}...`);
  const t = now();

  const tenant = await db
    .insertInto("tenants")
    .values({
      id: ulid(),
      slug: spec.slug,
      name: spec.name,
      domain: spec.domain,
      industry: spec.industry,
      plan_key: spec.planKey,
      brand_color: spec.brandColor,
      email_domain: spec.emailDomain,
      white_label: true,
      status: "ACTIVE",
      config: JSON.stringify({
        currency: "INR",
        timezone: "Asia/Kolkata",
        region: "IN",
        security: {
          mfa: true,
          ssoGoogle: true,
          ssoMicrosoft: true,
          saml: false,
          deviceControl: true,
          ipRestrictions: [],
        },
      }),
      created_at: daysAgo(30),
      updated_at: t,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const tid = tenant.id;

  await snapshotEntitlements(tid, spec.planKey);

  // ---- users ----
  const mkUser = async (
    name: string,
    role: string,
    pw: string,
    extra: { territory?: string[]; skills?: string[] } = {}
  ) => {
    return db
      .insertInto("users")
      .values({
        id: ulid(),
        tenant_id: tid,
        name,
        email: `${name.toLowerCase().split(" ")[0]}@${spec.emailDomain}`,
        password_hash: await bcrypt.hash(demoPassword(pw), BCRYPT_ROUNDS),
        role,
        status: "ACTIVE",
        avatar_color: spec.brandColor,
        territory: extra.territory ? JSON.stringify(extra.territory) : null,
        skills: extra.skills ? JSON.stringify(extra.skills) : null,
        created_at: daysAgo(29),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  };

  const isNorthwind = spec.slug === "northwind";
  const admin = await mkUser(isNorthwind ? "Maya" : "Arjun", "ADMIN", "admin123");
  const manager = await mkUser(isNorthwind ? "Vikram" : "Rahul", "MANAGER", "manager123");
  const sales1 = await mkUser(isNorthwind ? "Asha" : "Karan", "SALES_AGENT", "agent123", {
    territory: ["Bengaluru", "Hyderabad", "Chennai"],
    skills: ["WhatsApp", "Website Form", "Referral"],
  });
  const sales2 = await mkUser(isNorthwind ? "Neha" : "Priya", "SALES_AGENT", "agent123", {
    territory: ["Mumbai", "Pune", "Delhi"],
    skills: ["LinkedIn Forms", "Google Ads", "Facebook Lead Ads"],
  });
  const support = await mkUser(isNorthwind ? "Ravi" : "Sara", "SUPPORT_AGENT", "agent123");
  await mkUser(isNorthwind ? "Meera" : "Dev", "MARKETING_AGENT", "agent123");
  const finance = await mkUser(isNorthwind ? "Anil" : "Nina", "FINANCE", "agent123");
  const salesTeam = [sales1, sales2, manager];

  await db
    .insertInto("roles")
    .values({
      id: ulid(),
      tenant_id: tid,
      key: "CLOSER",
      name: "Closer",
      permissions: JSON.stringify(["leads", "deals", "contacts", "activities", "voice", "copilot"]),
      builtin: false,
      created_at: t,
      updated_at: t,
    })
    .execute();

  // ---- pipeline + stages ----
  const pipeline = await db
    .insertInto("pipelines")
    .values({
      id: ulid(),
      tenant_id: tid,
      name: "Sales Pipeline",
      is_default: true,
      created_at: daysAgo(29),
      updated_at: t,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  const stages: Selectable<DB["stages"]>[] = [];
  for (let i = 0; i < DEAL_STAGES.length; i++) {
    const spec = DEAL_STAGES[i];
    stages.push(
      await db
        .insertInto("stages")
        .values({
          id: ulid(),
          tenant_id: tid,
          pipeline_id: pipeline.id,
          name: spec.name,
          sort_order: i,
          won: spec.won,
          lost: spec.lost,
          created_at: daysAgo(29),
          updated_at: t,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    );
  }
  const stageBy = (nm: string) => stages.find((s) => s.name === nm)!;

  // ---- leads ----
  const cities = ["Bengaluru", "Mumbai", "Delhi", "Hyderabad", "Pune", "Chennai", "Bengaluru", "Bengaluru"];
  const sources = [
    "Website Form",
    "WhatsApp",
    "LinkedIn Forms",
    "Google Ads",
    "Facebook Lead Ads",
    "Referral",
    "Chat Widget",
    "Instagram Ads",
  ];
  const firstNames = ["Rohit", "Sneha", "Aman", "Pooja", "Vivek", "Divya", "Kunal", "Tara", "Manish", "Ritu", "Sahil", "Isha"];
  const lastNames = ["Sharma", "Patel", "Reddy", "Nair", "Gupta", "Iyer", "Singh", "Bose", "Mehta", "Rao", "Joshi", "Kapoor"];
  const leadNotes = [
    "Wants to switch into AI roles. Comparing two providers.",
    "Asked about pricing and EMI options. Interested, ready soon.",
    "Attended a webinar. Looking for placement support.",
    "Said the price is a bit expensive, will decide later.",
    "Very interested, wants a demo this week.",
    "Corporate L&D budget, evaluating for a team of 20.",
    "Filled the form but has been busy, no response yet.",
    "Loved the curriculum, asked to book a demo.",
  ];

  const leads: Selectable<DB["leads"]>[] = [];
  for (let i = 0; i < 12; i++) {
    const name = `${firstNames[i]} ${lastNames[i]}`;
    const owner = salesTeam[i % salesTeam.length];
    const lead = await db
      .insertInto("leads")
      .values({
        id: ulid(),
        tenant_id: tid,
        name,
        email: `${firstNames[i].toLowerCase()}@example.com`,
        phone: `+9198${String(10000000 + i * 137).slice(0, 8)}`,
        city: cities[i % cities.length],
        country: "India",
        source: sources[i % sources.length],
        campaign: i % 2 ? "May-Intake" : "AlwaysOn",
        status: i % 5 === 0 ? "DISQUALIFIED" : i % 7 === 0 ? "NOT_INTERESTED" : i % 3 === 0 ? "QUALIFIED" : "NEW",
        owner_id: owner.id,
        tags: JSON.stringify(i % 2 ? ["intake-may"] : ["high-budget"]),
        notes: leadNotes[i % leadNotes.length],
        budget: i % 3 === 0,
        last_activity_at: daysAgo(i % 20),
        created_at: daysAgo(20 - i),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    leads.push(lead);

    if (i % 5 === 0) {
      await db
        .insertInto("lead_documents")
        .values({
          id: ulid(),
          tenant_id: tid,
          lead_id: lead.id,
          name: "id-proof.pdf",
          doc_type: "kyc",
          uploaded_by: owner.id,
          created_at: daysAgo(i),
        })
        .execute();
    }
  }

  // ---- accounts + contracts + contacts ----
  const accountNames = ["Acme Corp", "Globex", "Initech", "Umbrella Ltd"];
  const accounts = [];
  for (let i = 0; i < accountNames.length; i++) {
    const nm = accountNames[i];
    const account = await db
      .insertInto("accounts")
      .values({
        id: ulid(),
        tenant_id: tid,
        name: nm,
        industry: "Technology",
        size: ["50-200", "200-1000", "10-50", "1000+"][i],
        website: nm.toLowerCase().replace(/\s/g, "") + ".example.com",
        owner_id: manager.id,
        departments: JSON.stringify(
          ["Engineering", "Procurement", "Learning & Development"].slice(0, (i % 3) + 1)
        ),
        created_at: daysAgo(28),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    accounts.push(account);
    if (i === 0) {
      await db
        .insertInto("account_contracts")
        .values({
          id: ulid(),
          tenant_id: tid,
          account_id: account.id,
          title: "Annual platform subscription",
          value: 600000,
          status: "ACTIVE",
          start_at: daysAgo(40),
          end_at: daysAhead(325),
          created_at: daysAgo(40),
          updated_at: t,
        })
        .execute();
    }
  }

  const contacts = [];
  for (let i = 0; i < 8; i++) {
    const name = `${firstNames[(i + 4) % 12]} ${lastNames[(i + 4) % 12]}`;
    const contact = await db
      .insertInto("contacts")
      .values({
        id: ulid(),
        tenant_id: tid,
        name,
        email: `${firstNames[(i + 4) % 12].toLowerCase()}.${i}@${["acme", "globex", "initech", "umbrella"][i % 4]}.example.com`,
        phone: `+9197${String(20000000 + i * 211).slice(0, 8)}`,
        company: accounts[i % 4].name,
        account_id: accounts[i % 4].id,
        title: ["Head of L&D", "CTO", "HR Director", "Engineering Manager"][i % 4],
        city: cities[i % cities.length],
        owner_id: salesTeam[i % salesTeam.length].id,
        tags: JSON.stringify(i % 2 ? ["customer"] : ["prospect"]),
        socials: JSON.stringify({
          linkedin: "linkedin.com/in/" + firstNames[(i + 4) % 12].toLowerCase(),
        }),
        lifecycle: i % 3 === 0 ? "CUSTOMER" : "LEAD",
        last_activity_at: daysAgo((i * 5) % 40),
        created_at: daysAgo(40 - i),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    contacts.push(contact);
  }

  // ---- deals ----
  const dealStages = [
    "Qualified",
    "Qualified",
    "Demo Scheduled",
    "Proposal Sent",
    "Negotiation",
    "Won",
    "Lost",
    "Qualified",
    "Proposal Sent",
    "Demo Completed",
  ];
  const deals = [];
  for (let i = 0; i < 10; i++) {
    const st = stageBy(dealStages[i]);
    const owner = salesTeam[i % salesTeam.length];
    const lead = leads[i];
    const value = 50000 + (i % 5) * 75000 + (i % 3) * 40000;
    const status = st.won ? "WON" : st.lost ? "LOST" : "OPEN";
    const deal = await db
      .insertInto("deals")
      .values({
        id: ulid(),
        tenant_id: tid,
        pipeline_id: pipeline.id,
        stage_id: st.id,
        title: `${lead.name.split(" ")[0]} - ${spec.edtech ? "Program" : "Project"}`,
        value,
        currency: "INR",
        owner_id: owner.id,
        lead_id: lead.id,
        account_id: accounts[i % 4].id,
        contact_id: contacts[i % contacts.length].id,
        status,
        expected_close_at: daysAhead(7 + (i % 4) * 7),
        closed_at: status === "OPEN" ? null : daysAgo(2),
        competitors: JSON.stringify(i % 2 ? ["Competitor X"] : []),
        stakeholders: JSON.stringify([{ name: lead.name, role: "Buyer" }]),
        created_at: daysAgo(18 - i),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    deals.push(deal);
  }

  // ---- activities ----
  const actTypes = ["CALL", "MEETING", "DEMO", "NOTE", "EMAIL", "TASK"] as const;
  const activities = [];
  for (let i = 0; i < 26; i++) {
    const lead = leads[i % leads.length];
    const deal = i % 2 ? deals[i % deals.length] : null;
    const activity = await db
      .insertInto("activities")
      .values({
        id: ulid(),
        tenant_id: tid,
        type: actTypes[i % actTypes.length],
        direction: i % 2 ? "OUTBOUND" : "INBOUND",
        subject: `${actTypes[i % actTypes.length]} with ${lead.name.split(" ")[0]}`,
        owner_id: salesTeam[i % salesTeam.length].id,
        lead_id: lead.id,
        deal_id: deal?.id ?? null,
        contact_id: i % 3 === 0 ? contacts[i % contacts.length].id : null,
        notes: summarize(leadNotes[i % leadNotes.length]),
        created_at: daysAgo(i % 18),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    activities.push(activity);
  }

  // ---- conversations + messages ----
  const seedThread = async (
    channel: "WHATSAPP" | "EMAIL",
    lead: (typeof leads)[number],
    lines: Array<["INBOUND" | "OUTBOUND", string]>
  ) => {
    const conv = await db
      .insertInto("conversations")
      .values({
        id: ulid(),
        tenant_id: tid,
        channel,
        lead_id: lead.id,
        subject: channel === "WHATSAPP" ? "WhatsApp" : "Email",
        status: "OPEN",
        last_message_at: t,
        last_preview: lines[lines.length - 1][1].slice(0, 80),
        created_at: daysAgo(4),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const msgs = [];
    for (let idx = 0; idx < lines.length; idx++) {
      const [dir, body] = lines[idx];
      const senti = sentiment(body);
      msgs.push(
        await db
          .insertInto("messages")
          .values({
            id: ulid(),
            tenant_id: tid,
            conversation_id: conv.id,
            channel,
            direction: dir,
            body,
            lead_id: lead.id,
            sentiment: senti.label,
            sentiment_score: senti.score,
            simulated: true,
            at: daysAgo(3 - Math.min(idx, 3)),
            created_at: daysAgo(3 - Math.min(idx, 3)),
            updated_at: t,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
      );
    }
    return msgs;
  };

  const messages = [
    ...(await seedThread("WHATSAPP", leads[1], [
      ["INBOUND", "Hi, is the AI program still open?"],
      ["OUTBOUND", "Yes! Want me to book a free demo?"],
      ["INBOUND", "Yes please, interested."],
    ])),
    ...(await seedThread("WHATSAPP", leads[4], [
      ["INBOUND", "What is the price?"],
      ["OUTBOUND", "Plans start at a special intake price. Shall I share details?"],
      ["INBOUND", "Sounds good"],
    ])),
    ...(await seedThread("EMAIL", leads[2], [
      ["OUTBOUND", "Thanks for attending our webinar. Here's the curriculum."],
      ["INBOUND", "Looks great, what about placement support?"],
    ])),
  ];

  // ---- stored AI fields: lead scores + deal probabilities ----
  for (const lead of leads) {
    const score = scoreLead(lead, activities, messages);
    await db
      .updateTable("leads")
      .set({
        score_total: score.total,
        score_grade: score.grade,
        score_breakdown: JSON.stringify(score),
        scored_at: t,
      })
      .where("id", "=", lead.id)
      .execute();
  }
  for (const deal of deals) {
    const health = dealHealth(deal, stages, activities);
    await db
      .updateTable("deals")
      .set({
        win_probability: winProbability(deal, stages, activities),
        health_score: health.score,
        health_label: health.label,
      })
      .where("id", "=", deal.id)
      .execute();
  }

  // ---- Email templates, journey ----
  // NOTE: WhatsApp templates are intentionally NOT seeded. A WhatsApp template
  // only exists once it is created and approved inside Meta's WhatsApp Manager;
  // its APPROVED status and meta_id come from Meta. Seeding fake "APPROVED" rows
  // would misrepresent templates that were never registered with Meta. Tenants
  // populate this table via "Sync from Meta" (real data) or local drafts.

  await db
    .insertInto("email_templates")
    .values({
      id: ulid(),
      tenant_id: tid,
      name: "Welcome",
      subject: "Welcome aboard",
      body: [
        "Hi {name},",
        "",
        "Welcome, and thanks for your interest. We are glad to have you on board.",
        "",
        "Our team will reach out shortly to understand your goals and show how we can help. In the meantime, just reply to this email with any questions.",
        "",
        "Warm regards,",
        "The team",
      ].join("\n"),
      category: "SALES",
      created_at: t,
      updated_at: t,
    })
    .execute();

  // ---- campaigns ----
  const campaignRows: Array<[string, string, number, number]> = [
    ["May Intake - Google", "Google", 120000, 540000],
    ["Retargeting - Facebook", "Facebook", 60000, 180000],
    ["WhatsApp Broadcast - Webinar", "WhatsApp", 15000, 220000],
  ];
  for (const [name, channel, cost, revenue] of campaignRows) {
    await db
      .insertInto("campaigns")
      .values({
        id: ulid(),
        tenant_id: tid,
        name,
        channel,
        cost,
        revenue,
        leads_generated: Math.round(revenue / 9000),
        status: "ACTIVE",
        start_at: daysAgo(20),
        created_at: daysAgo(20),
        updated_at: t,
      })
      .execute();
  }

  // ---- tickets + SLA ----
  await db
    .insertInto("sla_policies")
    .values({
      id: ulid(),
      tenant_id: tid,
      name: "Standard",
      first_response_hours: 4,
      resolution_hours: 24,
      is_default: true,
      created_at: t,
      updated_at: t,
    })
    .execute();

  const ticketSubjects = [
    "Cannot access course videos",
    "Refund request for duplicate payment",
    "Certificate not generated",
    "Login OTP not received",
    "Mentor session reschedule",
    "Invoice GST details",
  ];
  for (let i = 0; i < ticketSubjects.length; i++) {
    const s = ticketSubjects[i];
    const created = daysAgo(i);
    await db
      .insertInto("tickets")
      .values({
        id: ulid(),
        tenant_id: tid,
        subject: s,
        body: s + ". Please help.",
        priority: (["HIGH", "URGENT", "MEDIUM", "LOW"] as const)[i % 4],
        status: i % 3 === 0 ? "RESOLVED" : i % 3 === 1 ? "OPEN" : "PENDING",
        contact_id: contacts[i % contacts.length].id,
        assignee_id: support.id,
        channel: ["email", "whatsapp", "chat"][i % 3],
        sla_due_at: new Date(created.getTime() + 24 * 3600000),
        sentiment: sentiment(s).label,
        resolved_at: i % 3 === 0 ? daysAgo(Math.max(0, i - 1)) : null,
        created_at: created,
        updated_at: t,
      })
      .execute();
  }

  // ---- knowledge base ----
  const kbRows: Array<[string, string, string[]]> = [
    ["Pricing and plans", "Our plans start at an intake price with EMI options. Enterprise pricing is custom. Discounts apply during intake windows.", ["pricing", "plans", "emi"]],
    ["Refund policy", "Refunds are available within 7 days of purchase if less than 10% of the course is consumed. Duplicate payments are refunded in 5-7 days.", ["refund", "payment", "policy"]],
    ["How to book a demo", "Click Book Demo on the website, choose a slot, and you will receive a WhatsApp confirmation. A mentor will call you at the scheduled time.", ["demo", "booking", "schedule"]],
    ["Accessing your course", "Log in with your registered email, go to My Courses, and click Continue. Videos stream on web and mobile.", ["course", "access", "login", "videos"]],
    ["Certificate generation", "Certificates are generated within 24 hours of completing all modules and the final assessment.", ["certificate", "completion"]],
    ["Technical requirements", "A modern browser and a stable internet connection are enough. Mobile apps are available for Android and iOS.", ["technical", "browser", "mobile"]],
  ];
  for (let i = 0; i < kbRows.length; i++) {
    const [title, body, tags] = kbRows[i];
    await db
      .insertInto("kb_articles")
      .values({
        id: ulid(),
        tenant_id: tid,
        title,
        body,
        tags: JSON.stringify(tags),
        status: "PUBLISHED",
        views: (i * 73) % 400,
        created_at: daysAgo(15),
        updated_at: t,
      })
      .execute();
  }

  // ---- workflows ----
  const workflows: Array<[string, string, unknown[]]> = [
    [
      "New lead: assign + welcome email + WhatsApp",
      "lead.created",
      [
        { type: "ASSIGN_AGENT", params: { role: "SALES_AGENT" } },
        { type: "SEND_EMAIL", params: { templateName: "Welcome" } },
        { type: "SEND_WHATSAPP", params: { templateKey: "welcome" } },
        { type: "CREATE_TASK", params: { title: "Call {name} within 24h", dueInDays: 1 } },
      ],
    ],
    [
      "Ticket created: notify support",
      "ticket.created",
      [{ type: "NOTIFY", params: { role: "SUPPORT_AGENT", text: "New support ticket needs attention" } }],
    ],
    [
      "Deal won: tag customer",
      "deal.won",
      [
        { type: "ADD_TAG", params: { tag: "customer" } },
        { type: "NOTIFY", params: { role: "FINANCE", text: "New won deal, raise invoice" } },
      ],
    ],
  ];
  for (const [name, trigger, actions] of workflows) {
    await db
      .insertInto("workflows")
      .values({
        id: ulid(),
        tenant_id: tid,
        name,
        trigger,
        actions: JSON.stringify(actions),
        active: true,
        run_count: 0,
        created_at: daysAgo(25),
        updated_at: t,
      })
      .execute();
  }

  // ---- simulated voice calls ----
  const callLeads = [leads[0], leads[4], leads[7]];
  for (let i = 0; i < callLeads.length; i++) {
    const lead = callLeads[i];
    const sim = simulateVoiceCall({
      direction: "OUTBOUND",
      goal: i === 1 ? "reminder" : "qualify",
      contactName: lead.name.split(" ")[0],
    });
    await db
      .insertInto("voice_calls")
      .values({
        id: ulid(),
        tenant_id: tid,
        lead_id: lead.id,
        agent_user_id: sales1.id,
        direction: "OUTBOUND",
        goal: sim.goal,
        provider: "simulated",
        duration_sec: sim.durationSec,
        transcript: JSON.stringify(sim.transcript),
        summary: sim.summary,
        sentiment_label: sim.sentiment.label,
        sentiment_score: sim.sentiment.score,
        outcome: sim.outcome,
        lead_score_delta: sim.leadScoreDelta,
        action_items: JSON.stringify(sim.actionItems),
        completed_at: daysAgo(i + 1),
        created_at: daysAgo(i + 1),
        updated_at: t,
      })
      .execute();
  }

  // ---- finance ----
  const wonDeals = deals.filter((d) => d.status === "WON");
  for (let i = 0; i < wonDeals.length; i++) {
    const d = wonDeals[i];
    const invoice = await db
      .insertInto("invoices")
      .values({
        id: ulid(),
        tenant_id: tid,
        deal_id: d.id,
        account_id: d.account_id,
        number: `INV-${1000 + i}`,
        amount: d.value,
        tax: Math.round(d.value * 0.18),
        status: "PAID",
        gateway: "Razorpay",
        issued_at: daysAgo(5),
        paid_at: daysAgo(4),
        created_at: daysAgo(5),
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await db
      .insertInto("payments")
      .values({
        id: ulid(),
        tenant_id: tid,
        invoice_id: invoice.id,
        amount: invoice.amount + invoice.tax,
        status: "SUCCESS",
        gateway: "Razorpay",
        reference: "pay_" + (100000 + i),
        at: daysAgo(4),
        created_at: daysAgo(4),
        updated_at: t,
      })
      .execute();
  }
  const openDeal = deals.find((d) => d.status === "OPEN");
  if (openDeal) {
    await db
      .insertInto("invoices")
      .values({
        id: ulid(),
        tenant_id: tid,
        deal_id: openDeal.id,
        account_id: openDeal.account_id,
        number: "INV-2000",
        amount: openDeal.value,
        tax: Math.round(openDeal.value * 0.18),
        status: "OVERDUE",
        gateway: "Razorpay",
        issued_at: daysAgo(20),
        due_at: daysAgo(5),
        created_at: daysAgo(20),
        updated_at: t,
      })
      .execute();
  }

  // ---- calendar ----
  await db
    .insertInto("meetings")
    .values({
      id: ulid(),
      tenant_id: tid,
      title: `Demo with ${leads[4].name.split(" ")[0]}`,
      lead_id: leads[4].id,
      owner_id: sales1.id,
      start_at: daysAhead(1),
      duration_min: 30,
      mode: "ONLINE",
      location: "Google Meet",
      status: "SCHEDULED",
      reminder_at: daysAhead(1),
      created_at: t,
      updated_at: t,
    })
    .execute();
  await db
    .insertInto("meetings")
    .values({
      id: ulid(),
      tenant_id: tid,
      title: `Onsite review with ${accounts[0].name}`,
      contact_id: contacts[0].id,
      owner_id: manager.id,
      start_at: daysAhead(3),
      duration_min: 60,
      mode: "OFFLINE",
      location: "Client office",
      status: "SCHEDULED",
      reminder_at: daysAhead(3),
      created_at: t,
      updated_at: t,
    })
    .execute();
  await db
    .insertInto("booking_links")
    .values({
      id: ulid(),
      tenant_id: tid,
      name: "30-min Discovery Call",
      slug: "discovery-" + spec.slug,
      duration_min: 30,
      owner_id: sales1.id,
      bookings: 4,
      created_at: t,
      updated_at: t,
    })
    .execute();

  // ---- integrations, webhook, API key ----
  const integrationRows: Array<[string, string, string]> = [
    ["razorpay", "Razorpay", "payments"],
    ["whatsapp", "WhatsApp Business API", "communication"],
    ["google", "Google Calendar", "calendar"],
    ["zoho", "Zoho", "erp"],
  ];
  for (const [key, name, category] of integrationRows) {
    await db
      .insertInto("integrations")
      .values({
        id: ulid(),
        tenant_id: tid,
        key,
        name,
        category,
        connected: true,
        connected_at: daysAgo(10),
        created_at: daysAgo(10),
        updated_at: t,
      })
      .execute();
  }
  await db
    .insertInto("webhooks")
    .values({
      id: ulid(),
      tenant_id: tid,
      url: "https://hooks.example.com/crm",
      event: "deal.won",
      active: true,
      deliveries: 3,
      secret: sealSecret("whsec_seeded" + spec.slug),
      created_at: daysAgo(10),
      updated_at: t,
    })
    .execute();

  const rawApiKey = `crm_sk_${spec.slug}demo000000000000`;
  await db
    .insertInto("api_keys")
    .values({
      id: ulid(),
      tenant_id: tid,
      name: "Production key",
      key_hash: crypto.createHash("sha256").update(rawApiKey).digest("hex"),
      key_prefix: rawApiKey.slice(0, 14),
      created_by: admin.id,
      last_used_at: daysAgo(1),
      created_at: daysAgo(10),
      updated_at: t,
    })
    .execute();

  await db
    .insertInto("audit_logs")
    .values({
      id: ulid(),
      tenant_id: tid,
      user_id: admin.id,
      action: "tenant.created",
      entity_type: "tenant",
      entity_id: tid,
      meta: JSON.stringify({}),
      created_at: daysAgo(30),
    })
    .execute();

  // a notification for the finance user so the bell has content
  await db
    .insertInto("notifications")
    .values({
      id: ulid(),
      tenant_id: tid,
      user_id: finance.id,
      text: "Monthly revenue report is ready",
      read: false,
      created_at: daysAgo(1),
    })
    .execute();

  // A connected product with a catalog and a believable engagement history, so the
  // Products, Signals and per-lead Product panels have something to show. Without
  // it the whole integration surface seeds empty and reads as broken.
  await seedProductIntegration({
    db,
    tenantId: tid,
    leads: leads.map((l) => ({ id: l.id, name: l.name, email: l.email })),
    contacts: contacts.map((c) => ({ id: c.id, name: c.name, email: c.email })),
    edtech: spec.edtech,
  });

  console.log(`[seed] tenant ${spec.name} done`);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The demo seed never runs with NODE_ENV=production");
  }
  const force = process.argv.includes("--force");
  const existing = await db
    .selectFrom("tenants")
    .select(db.fn.count<number>("id").as("n"))
    .executeTakeFirst();
  if (Number(existing?.n ?? 0) > 0) {
    if (!force) {
      console.log("[seed] database already seeded; use --force to wipe and reseed");
      await closeDB();
      return;
    }
    await wipe();
  }

  await seedPlansAndOperator();
  await seedTenant({
    slug: "northwind",
    name: "Northwind Academy",
    domain: "crm.northwind.example.com",
    industry: "EdTech",
    planKey: "ENTERPRISE",
    brandColor: "#b6207f",
    emailDomain: "northwind.example.com",
    edtech: true,
  });
  await seedTenant({
    slug: "acme",
    name: "Acme Robotics",
    domain: "crm.acme.example.com",
    industry: "IT Services",
    planKey: "GROWTH",
    brandColor: "#1d4ed8",
    emailDomain: "acme.example.com",
    edtech: false,
  });

  console.log("[seed] all done. Logins:");
  const pw = (fallback: string) => (process.env.DEMO_PASSWORD ? "<DEMO_PASSWORD>" : fallback);
  console.log(`  maya@northwind.example.com / ${pw("admin123")}   (Northwind Academy, ENTERPRISE, workspace app)`);
  console.log(`  arjun@acme.example.com / ${pw("admin123")}       (Acme Robotics, GROWTH, workspace app)`);
  console.log(`  root@example.com / ${pw("operator123")}          (operator console)`);
  await closeDB();
}

main().catch(async (err) => {
  console.error("[seed] FAILED:", err);
  await closeDB();
  process.exit(1);
});
