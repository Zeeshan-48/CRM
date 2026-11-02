import compression from "compression";
import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import config from "./config";
import { NotFoundError } from "./errors";
import { serveLocalFile } from "./services/storage.service";
import { globalErrorHandler } from "./middlewares/error-handler.middleware";
import { globalApiLimiter } from "./middlewares/rate-limit.middleware";
import ingestRouter from "./routes/ingest.route";
import operatorRootRouter from "./routes/operator";
import operatorWebhookRouter from "./routes/operator/webhooks.route";
import exotelWebhookRouter from "./routes/exotel-webhook.route";
import rootRouter from "./routes";
import waWebhookRouter from "./routes/wa-webhook.route";

const app = express();

app.set("trust proxy", config.TRUST_PROXY);

// Liveness probe for the load balancer. Before all middleware/auth so health
// polls are never gated.
app.get("/up", (_req: Request, res: Response) => res.status(200).send("OK"));

// CORS: only the configured app origins (CORS_ORIGINS, by default the two
// SPAs). Other origins get no CORS headers, so browsers block the response.
// Server-to-server callers (ingest, webhooks) send no Origin and are unaffected.
const allowedOrigins = new Set(config.CORS_ORIGINS);
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  // The ingest API is called from integrators' own sites by the browser
  // tracker. It authenticates with a key, never a cookie, and publishable keys
  // are origin-locked server side, so any origin may call it.
  const isIngest = req.path.startsWith("/api/v1/ingest/");
  if (origin && (allowedOrigins.has(origin) || isIngest)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-API-Key, X-Requested-With, Accept, Origin"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

// gzip/deflate on responses above the 1KB default threshold. Mounted before the
// routers so it covers the list endpoints, which dominate response bytes.
app.use(compression());

// WhatsApp inbound webhook, mounted BEFORE the JSON parser so its raw-body
// parser can preserve the exact bytes for HMAC verification. Public (no auth);
// verified per-tenant via the URL token + X-Hub-Signature-256.
app.use("/api/v1/wa/webhooks", waWebhookRouter);

// Platform-billing gateway webhooks (Razorpay/Stripe), likewise BEFORE the JSON
// parser for raw-body signature verification. Public; authenticated by the
// gateway HMAC signature, not the operator JWT.
app.use("/api/v1/operator/webhooks", operatorWebhookRouter);

// Exotel telephony webhooks (Connect dynamic URL / Passthru / StatusCallback).
// Public; authenticated by the per-tenant unguessable URL token (Exotel signs
// nothing). Mounted here so provider callbacks bypass globalApiLimiter, a
// throttled Connect fetch is a live caller hearing dead air.
app.use("/api/v1/telephony/webhooks/exotel", exotelWebhookRouter);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);



// Local-disk storage driver (no AWS_S3_BUCKET): files are served only through
// short-lived signed links minted by storageService.getDownloadUrl.
app.get("/local-files/*key", serveLocalFile);

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ ok: true, service: "open-crm-api", at: new Date().toISOString() });
});

// Broad per-IP backstop for the whole API. Mounted AFTER the webhook routers
// (HMAC-verified provider callbacks must not be throttled) and the /up + health
// probes, so only tenant/operator API traffic is capped. Route-level limiters
// (auth, booking, LLM) add stricter buckets on top.
app.use(globalApiLimiter);

// Public inbound lead capture (external platforms -> leads). Authenticated by a
// workspace API key or a signed URL token, NOT the tenant JWT, so it is mounted
// outside the JWT-guarded root router. Its own tighter limiter is applied per
// route on top of the global per-IP backstop above.
app.use("/api/v1/ingest", ingestRouter);

// Operator console (platform tier). Mounted on its own prefix BEFORE the tenant
// root router so operator auth/audit/tenants routes never collide with the
// tenant routes of the same name. Guards its own operator-JWT auth internally.
app.use("/api/v1/operator", operatorRootRouter);

app.use("/api/v1", rootRouter);

app.use((req: Request, _res: Response) => {
  throw new NotFoundError(`Route not found: ${req.method} ${req.path}`);
});

app.use(globalErrorHandler);

export default app;
