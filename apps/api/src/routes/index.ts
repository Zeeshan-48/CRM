import { Router } from "express";
import { ModuleKey } from "../constants/modules.const";
import { authenticateUser } from "../middlewares/auth.middleware";
import { requireModule } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

import accountsRouter from "./accounts.route";
import activitiesRouter from "./activities.route";
import agentsRouter from "./agents.route";
import analyticsRouter from "./analytics.route";
import auditRouter from "./audit.route";
import authRouter from "./auth.route";
import billingRouter from "./billing.route";
import calendarRouter from "./calendar.route";
import campaignsRouter from "./campaigns.route";
import connectedAppsRouter from "./connected-apps.route";
import contactsRouter from "./contacts.route";
import copilotRouter from "./copilot.route";
import dealsRouter from "./deals.route";
import emailRouter from "./email.route";
import emailDomainsRouter from "./email-domains.route";
import emailIdentitiesRouter from "./email-identities.route";
import {
  emailMessagesRouter,
  emailReputationRouter,
  emailSuppressionsRouter,
} from "./email-log.route";
import financeRouter from "./finance.route";
import googleOAuthRouter from "./google-oauth.route";
import inboxRouter from "./inbox.route";
import integrationsRouter from "./integrations.route";
import kbRouter from "./kb.route";
import leadsRouter from "./leads.route";
import notificationsRouter from "./notifications.route";
import productsRouter from "./products.route";
import publicBookingRouter from "./public-booking.route";
import remindersRouter from "./reminders.route";
import searchRouter from "./search.route";
import signalsRouter from "./signals.route";
import tenantsRouter from "./tenants.route";
import telephonyRouter from "./telephony.route";
import ticketsRouter from "./tickets.route";
import unsubscribeRouter from "./unsubscribe.route";
import usersRouter from "./users.route";
import viewsRouter from "./views.route";
import whatsappRouter from "./whatsapp.route";
import workflowsRouter from "./workflows.route";

const rootRouter = Router();

// ---- Public ----
rootRouter.use("/auth", authRouter);
rootRouter.use("/unsubscribe", unsubscribeRouter);
// Google Calendar OAuth redirect callback (browser arrives from Google's consent
// screen with no JWT; trust comes from the HMAC-signed `state`).
rootRouter.use("/oauth/google", googleOAuthRouter);
// Public self-service booking page API (prospect books a slot -> becomes a lead).
rootRouter.use("/public/booking", publicBookingRouter);

// ---- Authenticated, not module-gated (workspace basics) ----
const A = (path: string, router: Router) => {
  rootRouter.use(path, asyncHandler(authenticateUser), router);
};
A("/tenant", tenantsRouter);
A("/users", usersRouter);
A("/notifications", notificationsRouter);
A("/search", searchRouter);
A("/views", viewsRouter);
A("/reminders", remindersRouter);
A("/billing", billingRouter);

// ---- Module-gated (entitlement + RBAC), one reviewable map ----
const M = (path: string, moduleKey: ModuleKey, router: Router) => {
  rootRouter.use(
    path,
    asyncHandler(authenticateUser),
    asyncHandler(requireModule(moduleKey)),
    router
  );
};
M("/leads", "leads", leadsRouter);
M("/contacts", "contacts", contactsRouter);
M("/accounts", "accounts", accountsRouter);
M("/deals", "deals", dealsRouter);
M("/activities", "activities", activitiesRouter);
M("/inbox", "inbox", inboxRouter);
M("/whatsapp", "whatsapp", whatsappRouter);
// Sending infrastructure and telephony are channel setup: entitlement-gated on
// the module they serve (email / voice), then RBAC.
M("/email-sending-domains", "email", emailDomainsRouter);
M("/email-sender-identities", "email", emailIdentitiesRouter);
M("/email-messages", "email", emailMessagesRouter);
M("/email-suppressions", "email", emailSuppressionsRouter);
M("/email-reputation", "email", emailReputationRouter);
M("/telephony", "voice", telephonyRouter);
M("/email", "email", emailRouter);
M("/campaigns", "campaigns", campaignsRouter);
M("/tickets", "tickets", ticketsRouter);
M("/kb", "kb", kbRouter);
M("/calendar", "calendar", calendarRouter);
M("/workflows", "workflows", workflowsRouter);
M("/copilot", "copilot", copilotRouter);
M("/agents", "agents", agentsRouter);
M("/analytics", "analytics", analyticsRouter);
M("/finance", "finance", financeRouter);
// Product integration platform. `connected-apps` is the wiring surface;
// `products` (catalog), `signals` and per-lead engagement land on the same gate
// on the same gate. See docs/architecture/product-integration.md.
M("/connected-apps", "products", connectedAppsRouter);
M("/products", "products", productsRouter);
M("/signals", "products", signalsRouter);
M("/integrations", "integrations", integrationsRouter);
M("/audit", "audit", auditRouter);

export default rootRouter;
