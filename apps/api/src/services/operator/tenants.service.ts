import bcrypt from "bcrypt";
import { db } from "../../db/connection";
import { DEAL_STAGES } from "../../constants/deal-stages.const";
import { tenant_status } from "../../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors";
import entitlementsRepository, {
  EntitlementRow,
} from "../../repositories/operator/entitlements.repository";
import pipelinesRepository from "../../repositories/operator/pipelines.repository";
import planGatewayRefsRepository from "../../repositories/operator/plan-gateway-refs.repository";
import plansRepository, { PlanRow } from "../../repositories/operator/plans.repository";
import type { SubscriptionRow } from "../../repositories/operator/subscriptions.repository";
import tenantsRepository, {
  TenantRow,
  TenantWithUsage,
} from "../../repositories/operator/tenants.repository";
import usersRepository, { TenantUserSummary } from "../../repositories/operator/users.repository";
import tenantBillingProfileRepository, {
  UpsertTenantBillingProfileInput,
} from "../../repositories/tenant-billing-profile.repository";
import logger from "../../utils/logger";
import { generateTempPassword } from "../../utils/password";
import auditService, { AuditActor } from "./audit.service";
import billingService from "./billing.service";
import emailService from "./email.service";
import { renderOnboardingEmail } from "./email/onboarding.template";
import entitlementsSyncService from "./entitlements-sync.service";
import { parseLimits, parseStringArray, planSnapshotSpecs } from "./plan-snapshot";
import { isBillingGateway } from "./platform-gateway.service";

const BCRYPT_ROUNDS = 12;

const DEFAULT_PIPELINE_NAME = "Sales Pipeline";
const DEFAULT_STAGES = DEAL_STAGES;

const isTenantStatus = (value: string): value is tenant_status =>
  Object.values(tenant_status).includes(value as tenant_status);

const slugify = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

class TenantsService {
  async list(filters: { q?: string; status?: string }): Promise<TenantWithUsage[]> {
    let status: tenant_status | undefined;
    if (filters.status) {
      if (!isTenantStatus(filters.status)) {
        throw new BadRequestError(
          `Invalid status: must be one of ${Object.values(tenant_status).join(", ")}`
        );
      }
      status = filters.status;
    }
    return tenantsRepository.listWithUsage({ q: filters.q, status });
  }

  async detail(id: string): Promise<{
    tenant: TenantRow;
    entitlements: EntitlementRow[];
    usage: { users: number; leads: number };
    adminUsers: TenantUserSummary[];
  }> {
    const tenant = await tenantsRepository.findById(id);
    if (!tenant) throw new NotFoundError("Tenant not found");
    const [entitlements, usage, adminUsers] = await Promise.all([
      entitlementsRepository.listByTenant(id),
      tenantsRepository.usage(id),
      usersRepository.listAdminsByTenant(id),
    ]);
    return { tenant, entitlements, usage, adminUsers };
  }

  async onboard(
    actor: AuditActor,
    body: {
      name?: string;
      slug?: string;
      industry?: string;
      domain?: string;
      brand_color?: string;
      plan_key?: string;
      gateway?: string;
      billingMode?: string;
      admin?: { name?: string; email?: string; password?: string };
    }
  ): Promise<{
    tenant: TenantRow;
    adminUser: TenantUserSummary;
    entitlements: EntitlementRow[];
    emailDispatched: boolean;
    subscription: SubscriptionRow | null;
    checkoutUrl: string | null;
  }> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw new BadRequestError("Name is required");

    const planKey = typeof body.plan_key === "string" ? body.plan_key.trim() : "";
    if (!planKey) throw new BadRequestError("plan_key is required");
    const plan = await plansRepository.findByKey(planKey);
    if (!plan || !plan.is_active) {
      throw new BadRequestError(`plan_key must reference an active plan: ${planKey}`);
    }

    // Optional upfront-payment billing. When a gateway is supplied the workspace
    // is created SUSPENDED with a PENDING subscription; it activates only on the
    // first successful charge. Validate the plan is billable on that gateway
    // BEFORE creating anything, so a misconfiguration fails cleanly.
    const gateway =
      typeof body.gateway === "string" && body.gateway.trim()
        ? body.gateway.trim().toUpperCase()
        : null;
    if (gateway) {
      if (!isBillingGateway(gateway)) {
        throw new BadRequestError("gateway must be one of RAZORPAY, STRIPE");
      }
      const ref = await planGatewayRefsRepository.find(plan.key, gateway, "MONTHLY");
      if (!ref) {
        throw new BadRequestError(
          `Plan ${plan.key} is not configured for ${gateway} billing (missing plan_gateway_refs)`
        );
      }
    }

    const adminName = typeof body.admin?.name === "string" ? body.admin.name.trim() : "";
    const adminEmail =
      typeof body.admin?.email === "string" ? body.admin.email.trim().toLowerCase() : "";
    if (!adminName || !adminEmail) {
      throw new BadRequestError("admin.name and admin.email are required");
    }

    const slug = slugify(typeof body.slug === "string" && body.slug.trim() ? body.slug : name);
    if (!slug) throw new BadRequestError("Could not derive a slug from the tenant name");
    const existing = await tenantsRepository.findBySlug(slug);
    if (existing) throw new ConflictError(`Tenant with slug ${slug} already exists`);

    // When the operator doesn't set a password we generate a secure random one
    // and email it to the workspace admin. (Previously this fell back to a
    // shared default.) If SES is unconfigured the admin gets no credentials and
    // must go through the tenant "forgot password" flow, surfaced to the
    // operator via `emailDispatched` in the response.
    const providedPassword =
      typeof body.admin?.password === "string" ? body.admin.password.trim() : "";
    const plainPassword = providedPassword || generateTempPassword();
    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);

    const result = await db.transaction().execute(async (trx) => {
      const tenant = await tenantsRepository.create(
        {
          slug,
          name,
          domain: typeof body.domain === "string" ? body.domain : null,
          industry: typeof body.industry === "string" ? body.industry : null,
          plan_key: plan.key,
          ...(typeof body.brand_color === "string" && body.brand_color
            ? { brand_color: body.brand_color }
            : {}),
        },
        trx
      );

      await entitlementsRepository.insertPlanSnapshot(tenant.id, planSnapshotSpecs(plan), trx);

      const adminUser = await usersRepository.createAdmin(
        { tenantId: tenant.id, name: adminName, email: adminEmail, passwordHash },
        trx
      );

      await pipelinesRepository.createWithStages(
        {
          tenantId: tenant.id,
          name: DEFAULT_PIPELINE_NAME,
          isDefault: true,
          stages: DEFAULT_STAGES,
        },
        trx
      );

      const entitlements = await entitlementsRepository.listByTenant(tenant.id, trx);
      return { tenant, adminUser, entitlements };
    });

    auditService.log(actor, "tenant.created", "tenants", {
      tenantId: result.tenant.id,
      resourceId: result.tenant.id,
      summary: `${actor.email} onboarded tenant ${name} (${slug}) on plan ${plan.key}`,
      metadata: { name, slug, plan_key: plan.key, admin_email: adminEmail },
    });

    // Upfront-payment billing: suspend the fresh workspace first (no access
    // until paid), then start the PENDING subscription and get the hosted
    // checkout URL the admin completes. No gateway => comp/manual tenant, active
    // immediately (legacy behaviour, unchanged).
    let subscription: SubscriptionRow | null = null;
    let checkoutUrl: string | null = null;
    let tenant = result.tenant;
    if (gateway) {
      try {
        const suspended = await tenantsRepository.update(tenant.id, { status: "SUSPENDED" });
        if (suspended) tenant = suspended;
        const created = await billingService.createForTenant(actor, tenant.id, {
          gateway,
          planKey: plan.key,
          billingMode: body.billingMode,
        });
        subscription = created.subscription;
        checkoutUrl = created.checkoutUrl;
      } catch (err) {
        // Billing setup failed (e.g. gateway rejected the plan/price). Compensate
        // by deleting the just-created tenant, cascades its admin, entitlements,
        // pipeline and subscription, so onboarding stays all-or-nothing rather
        // than leaving a suspended, unusable orphan with the slug taken.
        await db.deleteFrom("tenants").where("id", "=", tenant.id).execute();
        throw err;
      }
    }

    // Welcome email. Fire-and-forget: a mail hiccup must never fail onboarding.
    // When billing is on, the email leads with the "complete your subscription"
    // CTA (checkoutUrl); otherwise the sign-in CTA.
    void this.dispatchOnboardingEmail(actor, {
      tenant,
      plan,
      adminName,
      adminEmail,
      plainPassword,
      checkoutUrl,
    });

    return {
      ...result,
      tenant,
      emailDispatched: emailService.isConfigured(),
      subscription,
      checkoutUrl,
    };
  }

  private async dispatchOnboardingEmail(
    actor: AuditActor,
    params: {
      tenant: TenantRow;
      plan: PlanRow;
      adminName: string;
      adminEmail: string;
      plainPassword: string;
      checkoutUrl?: string | null;
    }
  ): Promise<void> {
    try {
      const limits = parseLimits(params.plan.limits);
      const email = renderOnboardingEmail({
        adminName: params.adminName,
        adminEmail: params.adminEmail,
        tempPassword: params.plainPassword,
        workspaceName: params.tenant.name,
        workspaceSlug: params.tenant.slug,
        planName: params.plan.name,
        planKey: params.plan.key,
        priceMonthly: Number(params.plan.price_monthly) || 0,
        currency: params.plan.currency || "INR",
        industry: params.tenant.industry,
        modules: parseStringArray(params.plan.modules),
        limits: {
          seats: limits.seats ?? 0,
          leads: limits.leads ?? 0,
          ai_credits_monthly: limits.ai_credits_monthly ?? 0,
        },
        checkoutUrl: params.checkoutUrl ?? null,
      });

      const sendResult = await emailService.send({
        to: params.adminEmail,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });

      const action = sendResult.sent
        ? "tenant.welcome_email_sent"
        : sendResult.skipped
          ? "tenant.welcome_email_skipped"
          : "tenant.welcome_email_failed";
      const summary = sendResult.sent
        ? `Welcome email sent to ${params.adminEmail} for tenant ${params.tenant.name}`
        : sendResult.skipped
          ? `Welcome email skipped (SES not configured) for tenant ${params.tenant.name}`
          : `Welcome email failed for tenant ${params.tenant.name}: ${sendResult.error ?? "unknown error"}`;

      auditService.log(actor, action, "tenants", {
        tenantId: params.tenant.id,
        resourceId: params.tenant.id,
        summary,
        metadata: {
          to: params.adminEmail,
          messageId: sendResult.messageId ?? null,
          error: sendResult.error ?? null,
        },
      });
    } catch (err) {
      logger.error(
        `[onboarding-email] unexpected error for tenant ${params.tenant.id}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  async update(
    actor: AuditActor,
    id: string,
    body: { name?: string; brand_color?: string; status?: string; plan_key?: string }
  ): Promise<TenantRow> {
    const existing = await tenantsRepository.findById(id);
    if (!existing) throw new NotFoundError("Tenant not found");

    const patch: { name?: string; brand_color?: string; status?: tenant_status } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new BadRequestError("Name cannot be empty");
      patch.name = name;
    }
    if (body.brand_color !== undefined) {
      if (typeof body.brand_color !== "string" || !body.brand_color.trim()) {
        throw new BadRequestError("brand_color must be a non-empty string");
      }
      patch.brand_color = body.brand_color.trim();
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !isTenantStatus(body.status)) {
        throw new BadRequestError(
          `Invalid status: must be one of ${Object.values(tenant_status).join(", ")}`
        );
      }
      patch.status = body.status;
    }

    let newPlan: PlanRow | undefined;
    if (body.plan_key !== undefined) {
      const planKey = typeof body.plan_key === "string" ? body.plan_key.trim() : "";
      newPlan = planKey ? await plansRepository.findByKey(planKey) : undefined;
      if (!newPlan || !newPlan.is_active) {
        throw new BadRequestError(`plan_key must reference an active plan: ${planKey}`);
      }
    }

    if (!Object.keys(patch).length && !newPlan) throw new BadRequestError("Nothing to update");

    const updated = await db.transaction().execute(async (trx) => {
      if (newPlan) {
        // Plan change: drop the previous PLAN snapshot and re-snapshot from
        // the new plan. ADMIN-sourced override rows are preserved as-is.
        await entitlementsRepository.deletePlanSourced(id, trx);
        await entitlementsRepository.insertPlanSnapshot(id, planSnapshotSpecs(newPlan), trx);
      }
      return tenantsRepository.update(id, { ...patch, plan_key: newPlan?.key }, trx);
    });
    if (!updated) throw new NotFoundError("Tenant not found");

    // Reconcile against subscription state. A plan change re-snapshots the plan
    // rows above; if the tenant's subscription has actually lapsed, this strips
    // them straight back out rather than silently re-granting paid access.
    await entitlementsSyncService.sync(id);

    auditService.log(actor, "tenant.updated", "tenants", {
      tenantId: updated.id,
      resourceId: updated.id,
      summary: `${actor.email} updated tenant ${updated.name}`,
      metadata: { ...patch, ...(newPlan ? { plan_key: newPlan.key } : {}) },
    });
    return updated;
  }

  async overrideEntitlement(
    actor: AuditActor,
    tenantId: string,
    body: { code?: string; enabled?: boolean; limit_value?: number | null }
  ): Promise<EntitlementRow> {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found");

    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) throw new BadRequestError("code is required");
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
      throw new BadRequestError("enabled must be a boolean");
    }
    if (
      body.limit_value !== undefined &&
      body.limit_value !== null &&
      !Number.isInteger(body.limit_value)
    ) {
      throw new BadRequestError("limit_value must be an integer or null");
    }

    const row = await entitlementsRepository.upsertAdminOverride(tenantId, code, {
      enabled: body.enabled,
      limit_value: body.limit_value,
    });

    auditService.log(actor, "tenant.entitlement_overridden", "tenants", {
      tenantId,
      resourceId: row.id,
      summary: `${actor.email} overrode entitlement ${code} for tenant ${tenant.name}`,
      metadata: { code, enabled: row.enabled, limit_value: row.limit_value },
    });
    return row;
  }

  async getBillingProfile(tenantId: string) {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found");
    return tenantBillingProfileRepository.findByTenantId(tenantId);
  }

  async saveBillingProfile(
    actor: AuditActor,
    tenantId: string,
    body: UpsertTenantBillingProfileInput
  ) {
    const tenant = await tenantsRepository.findById(tenantId);
    if (!tenant) throw new NotFoundError("Tenant not found");

    const profile = await tenantBillingProfileRepository.upsert(tenantId, body);

    auditService.log(actor, "tenant.billing_profile_saved", "tenants", {
      tenantId,
      resourceId: profile.id,
      summary: `${actor.email} updated tax invoice & legal profile for tenant ${tenant.name} (verified: ${profile.is_verified})`,
      metadata: { is_verified: profile.is_verified, legal_name: profile.legal_name },
    });

    return profile;
  }
}

export default new TenantsService();
