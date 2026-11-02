import path from "path";
import dotenv from "dotenv";

dotenv.config();

const DEV_JWT_SECRET = "dev-only-jwt-secret-change-me";
const DEV_ENCRYPTION_KEY = "dev-only-encryption-key-change-me";

const config = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  isProduction: process.env.NODE_ENV === "production",
  PORT: process.env.PORT || "5066",

  JWT_SECRET: process.env.JWT_SECRET || DEV_JWT_SECRET,
  // Bearer tokens are not revocable (see docs/architecture/security.md), so keep
  // them short. Users sign in again after this.
  JWT_EXPIRY: process.env.JWT_EXPIRY || "12h",

  // Browser origins allowed to call the API (comma separated). Defaults to the
  // two SPAs. "*" is refused because responses carry credentials.
  CORS_ORIGINS: (
    process.env.CORS_ORIGINS ||
    `${process.env.CRM_APP_URL || "http://localhost:3570"},${process.env.OPERATOR_APP_URL || "http://localhost:3580"}`
  )
    .split(",")
    .map((o) => o.trim().replace(/\/$/, ""))
    .filter((o) => o && o !== "*"),
  // Number of reverse proxies in front of the API (ALB = 1, CloudFront + ALB =
  // 2). Decides which X-Forwarded-For entry is the client IP for rate limits.
  TRUST_PROXY: Number(process.env.TRUST_PROXY || "1"),

  PG_DATABASE_HOST: process.env.PG_DATABASE_HOST ?? "localhost",
  PG_DATABASE_USER: process.env.PG_DATABASE_USER ?? "postgres",
  PG_DATABASE_PASSWORD: process.env.PG_DATABASE_PASSWORD ?? "postgres",
  PG_DATABASE_PORT: process.env.PG_DATABASE_PORT ?? "5432",
  PG_DATABASE: process.env.PG_DATABASE ?? "crm",
  PG_POOL_MAX: process.env.PG_POOL_MAX,
  PG_POOL_MIN: process.env.PG_POOL_MIN,
  PG_CONNECTION_TIMEOUT: process.env.PG_CONNECTION_TIMEOUT,
  PG_IDLE_TIMEOUT: process.env.PG_IDLE_TIMEOUT,

  AWS_REGION: process.env.AWS_REGION || "us-east-1",
  // Bucket for CRM files (lead documents, call recordings). Blank = local disk.
  // Credentials come from AWS_S3_ACCESS_KEY/SECRET_KEY when set, else the
  // default AWS chain (the ECS task role in production).
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET ?? "",
  AWS_S3_ACCESS_KEY: process.env.AWS_S3_ACCESS_KEY ?? "",
  AWS_S3_SECRET_KEY: process.env.AWS_S3_SECRET_KEY ?? "",
  // Override endpoint for every AWS client (a local emulator such as Floci).
  AWS_ENDPOINT_URL: process.env.AWS_ENDPOINT_URL ?? "",

  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  // Platform-default key for Google Gemini LLM (voice engine). Blank => tenant must
  // bring its own Gemini key.
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",

  // platform default WhatsApp tier (used when a tenant hasn't connected their own).
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
  WHATSAPP_API_KEY: process.env.WHATSAPP_API_KEY ?? "",
  // Meta Graph API version + a dev simulate switch (mirrors TELEPHONY_SIMULATE).
  // Accepts META_GRAPH_API_VERSION as an alias so backend + frontend
  // (VITE_META_GRAPH_API_VERSION) can share one version value.
  WHATSAPP_API_VERSION:
    process.env.WHATSAPP_API_VERSION ?? process.env.META_GRAPH_API_VERSION ?? "v21.0",
  WHATSAPP_SIMULATE: process.env.WHATSAPP_SIMULATE === "true",
  WHATSAPP_DEFAULT_TEMPLATE_LANG: process.env.WHATSAPP_DEFAULT_TEMPLATE_LANG ?? "en_US",
  // Testing guard: comma-separated E.164 numbers that may receive REAL sends.
  // When set, any send to a number NOT on this list is recorded as simulated
  // instead of hitting Meta, so testing never burns the daily message limit on
  // real leads. Blank => no restriction (every send goes live).
  WHATSAPP_TEST_ALLOWLIST: process.env.WHATSAPP_TEST_ALLOWLIST ?? "",

  // Meta Embedded Signup (BYO WhatsApp "Connect with Facebook" flow). the operator is
  // the Tech Provider: our app id + secret broker the tenant's OAuth code
  // exchange; the tenant still connects THEIR OWN WABA + number. The webhook
  // verify token + app secret are platform-level (one shared app callback that
  // resolves tenant by waba_id). Blank => Embedded Signup disabled (the Connect
  // button hides); sends/tests still run simulated.
  META_APP_ID: process.env.META_APP_ID ?? "",
  META_APP_SECRET: process.env.META_APP_SECRET ?? "",
  META_WEBHOOK_VERIFY_TOKEN: process.env.META_WEBHOOK_VERIFY_TOKEN ?? "",

  AWS_SES_REGION: process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1",
  AWS_SES_ACCESS_KEY: process.env.AWS_SES_ACCESS_KEY ?? "",
  AWS_SES_SECRET_KEY: process.env.AWS_SES_SECRET_KEY ?? "",
  AWS_SES_FROM_EMAIL: process.env.AWS_SES_FROM_EMAIL ?? "",
  AWS_SES_FROM_NAME: process.env.AWS_SES_FROM_NAME || "Open CRM",

  // The frontend (SPA) base URL, where the browser lands. Single source of
  // truth for every customer-facing link the backend builds: sign-in / invite /
  // password-reset emails, public booking links ({CRM_APP_URL}/meet/...), the
  // calendar OAuth return page, and Stripe checkout redirects. Bare origin, no
  // trailing slash. BRAND_NAME is the email display copy; the single platform
  // sender/contact address is AWS_SES_FROM_EMAIL.
  CRM_APP_URL: process.env.CRM_APP_URL || "http://localhost:3570",
  // The operator console (platform admin) SPA base URL, used for operator
  // password-reset links. Bare origin, no trailing slash.
  OPERATOR_APP_URL: process.env.OPERATOR_APP_URL || "http://localhost:3580",
  BRAND_NAME: process.env.BRAND_NAME || "Open CRM",

  // Per-tenant sending-domain (BYOSD) event pipeline. Empty until the SNS
  // topic + SQS queue exist (Terraform email module, or scripts/ses-infra-setup.ts); the events consumer
  // stays idle while unset, and sends still work via the resolver/fallback.
  SES_EVENTS_SNS_TOPIC_ARN: process.env.SES_EVENTS_SNS_TOPIC_ARN ?? "",
  SES_EVENTS_QUEUE_URL: process.env.SES_EVENTS_QUEUE_URL ?? "",
  // SQS queue that receives inbound emails (SES receipt rule -> SNS -> SQS).
  // Unset = email inbound consumer idle. Receiving region may differ from
  // sending; SES email receiving is not in every region.
  SES_INBOUND_QUEUE_URL: process.env.SES_INBOUND_QUEUE_URL ?? "",
  SES_INBOUND_REGION: process.env.SES_INBOUND_REGION || process.env.AWS_SES_REGION || process.env.AWS_REGION || "us-east-1",

  // Redis (resolver cache + send rate limiting). Empty disables Redis and the
  // app fails open (in-process compute, no rate cap). Not used under tests.
  REDIS_URL: process.env.REDIS_URL ?? "",
  // HTTP rate limiting (auth brute-force, public-endpoint abuse, LLM cost).
  // On by default; set to "false" to disable every limiter (e.g. load testing).
  // Redis-backed when REDIS_URL is set (shared across instances), else an
  // in-memory per-instance window. Always disabled under tests.
  RATE_LIMIT_ENABLED: process.env.RATE_LIMIT_ENABLED !== "false",
  // Legacy per-tenant cap; kept for continuity (EMAIL_ACCOUNT_TPS falls back to it).
  EMAIL_MAX_SEND_PER_SECOND: Number(process.env.EMAIL_MAX_SEND_PER_SECOND ?? "14"),
  // Per-tenant base send rate (sends/second). The reputation category multiplier
  // scales this, and a tenant can override it via tenants.config.emailTps.
  EMAIL_DEFAULT_TENANT_TPS: Number(process.env.EMAIL_DEFAULT_TENANT_TPS ?? "5"),
  // Account-wide ceiling across all tenants (sends/second). Falls back to the
  // legacy EMAIL_MAX_SEND_PER_SECOND when not set.
  EMAIL_ACCOUNT_TPS: Number(
    process.env.EMAIL_ACCOUNT_TPS ?? process.env.EMAIL_MAX_SEND_PER_SECOND ?? "14"
  ),

  // Public base URL used to build List-Unsubscribe links for marketing email.
  APP_PUBLIC_URL: process.env.APP_PUBLIC_URL || "http://localhost:5066",

  // Telephony (Twilio) default tier. Empty keys => simulated calls (no real
  // calls placed), so the app and tests run with no Twilio account.
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? "",
  TWILIO_DEFAULT_FROM_NUMBER: process.env.TWILIO_DEFAULT_FROM_NUMBER ?? "",
  // Key that encrypts every tenant-supplied credential at rest (Twilio, Exotel,
  // WhatsApp, Razorpay, Stripe, integration keys, webhook signing secrets). Any
  // string of 32+ characters; it is hashed to a 32-byte AES key. Production
  // refuses to start without one. TELEPHONY_ENCRYPTION_KEY is the old name.
  CREDENTIALS_ENCRYPTION_KEY:
    process.env.CREDENTIALS_ENCRYPTION_KEY ||
    process.env.TELEPHONY_ENCRYPTION_KEY ||
    DEV_ENCRYPTION_KEY,
  // Force simulated telephony (no real Twilio calls) even in dev, so the whole
  // flow is demoable without a Twilio account. Tests always simulate regardless.
  TELEPHONY_SIMULATE: process.env.TELEPHONY_SIMULATE === "true",
  // Exotel is BYO-only (no platform default account); this flag lets the whole
  // Exotel flow run simulated in dev without an Exotel account.
  EXOTEL_SIMULATE: process.env.EXOTEL_SIMULATE === "true",

  // Payments (Razorpay) default tier. Empty keys => simulated (no real payment
  // links / charges), so the app and tests run with no Razorpay account. Tenant
  // BYO key secrets are encrypted with CREDENTIALS_ENCRYPTION_KEY.
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? "",
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? "",
  RAZORPAY_SIMULATE: process.env.RAZORPAY_SIMULATE === "true",

  // Payments (Stripe) default tier + simulate switch. Currency defaults to INR
  // (invoices are in rupees); set STRIPE_CURRENCY=usd for a USD Stripe account.
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY ?? "",
  STRIPE_SIMULATE: process.env.STRIPE_SIMULATE === "true",
  STRIPE_CURRENCY: (process.env.STRIPE_CURRENCY ?? "inr").toLowerCase(),

  // Platform billing (operator tier): the operator charges tenants for their plan on
  // the operator's OWN gateway account, reuses RAZORPAY_KEY_ID/SECRET + STRIPE_SECRET_KEY
  // above. BILLING_SIMULATE forces canned subscriptions (no real charges) even
  // when those platform keys are live; tests always simulate. Webhook secrets
  // verify inbound gateway events. See docs/platform-billing.md.
  BILLING_SIMULATE: process.env.BILLING_SIMULATE === "true",
  // Dunning grace: days a PAST_DUE subscription keeps the workspace live before
  // the sweep suspends it.
  BILLING_GRACE_DAYS: Number(process.env.BILLING_GRACE_DAYS ?? "3"),
  // Where the gateway returns the tenant admin after the hosted checkout. Points
  // at the SPA LOGIN page (public), a first-time admin pays before they can log
  // in, so the landing must not be an auth-gated page.
  BILLING_RETURN_URL:
    process.env.BILLING_RETURN_URL ??
    `${process.env.CRM_APP_URL || "http://localhost:3570"}/login`,
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET ?? "",

  // Google Calendar integration (per-user OAuth). BLANK client id/secret =>
  // feature OFF: the provider card stays "Connect via Integrations", meetings
  // keep the CRM-native Jitsi link + CRM-only availability (exactly today's
  // behavior). GOOGLE_CALENDAR_ENABLED is an extra master switch so the feature
  // can be turned off even when creds exist. googleCalendarEnabled() (utils)
  // gates every call, nothing hits Google until all three are set. Scopes
  // requested are minimal: calendar.events (push) + calendar.freebusy (avail).
  // Accepts GOOGLE_CALENDAR_CLIENT_ID/SECRET/REDIRECT_URI (the names used in
  // .env) with the shorter GOOGLE_CLIENT_ID/SECRET as a fallback.
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? "",
  GOOGLE_CLIENT_SECRET:
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET ?? "",
  // Where Google returns the browser after consent. MUST be registered verbatim
  // as an Authorized redirect URI in the Google Cloud OAuth client. Defaults to
  // the API host callback; override if the API is behind a different public URL.
  GOOGLE_OAUTH_REDIRECT_URL:
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ??
    process.env.GOOGLE_OAUTH_REDIRECT_URL ??
    `${process.env.APP_PUBLIC_URL || "http://localhost:5066"}/api/v1/oauth/google/calendar/callback`,
  // Master on/off. Only "false" disables; unset defaults to on, so simply
  // providing client id/secret is enough to enable in dev.
  GOOGLE_CALENDAR_ENABLED: process.env.GOOGLE_CALENDAR_ENABLED !== "false",

  // Local-disk storage root, used when AWS_S3_BUCKET is blank.
  LOCAL_STORAGE_DIR: path.resolve(process.env.LOCAL_STORAGE_DIR || path.join(process.cwd(), ".local-storage")),
};

/**
 * Production refuses to start on development defaults: a guessable JWT secret
 * lets anyone mint tokens, and a guessable credentials key decrypts every
 * tenant's provider keys.
 */
export function assertProductionConfig(c: typeof config = config): void {
  if (!c.isProduction) return;
  const problems: string[] = [];
  if (c.JWT_SECRET === DEV_JWT_SECRET || c.JWT_SECRET.length < 32) {
    problems.push("JWT_SECRET must be set to a random value of at least 32 characters");
  }
  if (c.CREDENTIALS_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY || c.CREDENTIALS_ENCRYPTION_KEY.length < 32) {
    problems.push("CREDENTIALS_ENCRYPTION_KEY must be set to a random value of at least 32 characters");
  }
  if (c.CORS_ORIGINS.length === 0) problems.push("CORS_ORIGINS must list the app origins");
  if (problems.length) {
    throw new Error(`Refusing to start in production:\n  - ${problems.join("\n  - ")}`);
  }
}

export default config;
