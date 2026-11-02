import bcrypt from "bcrypt";
import config from "../config";
import { GOVERNANCE_CAPABILITIES, isGovernanceCapability } from "../constants/modules.const";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../errors";
import tenantsRepository from "../repositories/tenants.repository";
import usersRepository from "../repositories/users.repository";
import {
  decodePasswordResetToken,
  signPasswordResetToken,
  signTenantToken,
  verifyPasswordResetToken,
} from "../utils/jwt.util";
import logger from "../utils/logger";
import { renderPasswordResetLinkEmail } from "./email/password-reset-link.template";
import engineService from "./engine.service";
import entitlementsService from "./entitlements.service";
import mailerService from "./mailer.service";
import rbacService from "./rbac.service";

const BCRYPT_ROUNDS = 12;
// How long a self-service reset link stays valid (keep in sync with the JWT
// expiry in signPasswordResetToken).
const RESET_LINK_TTL_LABEL = "1 hour";

// The modules surfaced to the client drive the nav + route guards. Feature
// modules are the intersection of the user's role and the tenant's plan
// entitlement, without it an ADMIN ("*") on a smaller plan would render nav for
// modules the backend 403s. Governance capabilities (channels, team, billing,
// settings) are RBAC-only: they exist in every workspace, carry no entitlement,
// and so are added purely from the role, never filtered by the plan.
const resolveVisibleModules = async (
  tenantId: string,
  user: { tenantId: string; role: string; permissions: string[] | null }
): Promise<string[]> => {
  const [roleModules, entitlements] = await Promise.all([
    rbacService.getModulesForUser(user),
    entitlementsService.getAll(tenantId),
  ]);
  const entitled = entitlements
    .filter((e) => e.enabled && e.code.startsWith("module."))
    .map((e) => e.code.slice("module.".length));
  // ADMIN ("*"): every entitled feature module + all governance capabilities.
  if (roleModules.includes("*")) return [...entitled, ...GOVERNANCE_CAPABILITIES];
  // Others: entitled feature modules the role grants + any governance
  // capabilities the role grants (no entitlement filter on governance).
  const features = roleModules.filter((m) => entitled.includes(m));
  const governance = roleModules.filter((m) => isGovernanceCapability(m));
  return [...features, ...governance];
};

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: string;
  tenant_id: string;
  phone: string | null;
  available_for_calls: boolean;
  modules: string[];
  tenant: {
    id: string;
    slug: string;
    name: string;
    brand_color: string;
    plan_key: string | null;
    domain: string | null;
  };
}

/** Request-derived context recorded on sign-in / sign-out audit events. */
export interface AuthContext {
  ip?: string | null;
  userAgent?: string | null;
}

// bcrypt hash of a random string, compared against when no account matches.
const TIMING_DUMMY_HASH = "$2b$12$qyglGcmoO6XRIEyihh3Q.exjl44ujxp9PItoyl26iHvXPV6VhWqcG";

class AuthService {
  async login(
    email?: string,
    password?: string,
    context: AuthContext = {}
  ): Promise<{ token: string; user: PublicUser }> {
    if (!email || !password) throw new BadRequestError("Email and password are required");

    const candidates = await usersRepository.findByEmailWithTenants(email);
    // An unknown email still pays for one bcrypt comparison, so response time
    // does not reveal whether an account exists.
    if (candidates.length === 0) await bcrypt.compare(password, TIMING_DUMMY_HASH);
    let matched: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      const ok = await bcrypt.compare(password, candidate.password_hash);
      if (ok) {
        matched = candidate;
        // Prefer a fully active account when the email exists in many tenants.
        if (candidate.status === "ACTIVE" && candidate.tenant_status === "ACTIVE") break;
      }
    }

    if (!matched) throw new UnauthorizedError("Invalid email or password");
    if (matched.status !== "ACTIVE") throw new UnauthorizedError("Account disabled");
    if (matched.tenant_status !== "ACTIVE") {
      throw new ForbiddenError("This workspace is suspended. Contact your platform operator.");
    }

    const token = signTenantToken({
      id: matched.id,
      tenantId: matched.tenant_id,
      role: matched.role,
      type: "tenant",
    });

    const modules = await resolveVisibleModules(matched.tenant_id, {
      tenantId: matched.tenant_id,
      role: matched.role,
      permissions: Array.isArray(matched.permissions) ? (matched.permissions as string[]) : null,
    });

    usersRepository.touchLastLogin(matched.id);
    engineService.audit(matched.tenant_id, matched.id, "auth.login", "user", matched.id, {
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });

    return {
      token,
      user: {
        id: matched.id,
        name: matched.name,
        email: matched.email,
        role: matched.role,
        tenant_id: matched.tenant_id,
        phone: matched.phone ?? null,
        available_for_calls: matched.available_for_calls ?? true,
        modules,
        tenant: {
          id: matched.tenant_id,
          slug: matched.tenant_slug,
          name: matched.tenant_name,
          brand_color: matched.tenant_brand_color,
          plan_key: matched.tenant_plan_key,
          domain: matched.tenant_domain,
        },
      },
    };
  }

  // Stateless JWT auth has no server session to destroy, so logout just records
  // the audit trail (who signed out, when, from where). The token is dropped
  // client-side.
  async logout(
    authUser: { id: string; tenantId: string },
    context: AuthContext = {}
  ): Promise<{ ok: true }> {
    engineService.audit(authUser.tenantId, authUser.id, "auth.logout", "user", authUser.id, {
      ip: context.ip ?? null,
      userAgent: context.userAgent ?? null,
    });
    return { ok: true };
  }

  async me(authUser: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    role: string;
    permissions: string[] | null;
  }): Promise<PublicUser> {
    const tenant = await tenantsRepository.findById(authUser.tenantId);
    if (!tenant) throw new UnauthorizedError("Workspace not found");
    const modules = await resolveVisibleModules(authUser.tenantId, authUser);
    const profile = await usersRepository.findById(authUser.id, authUser.tenantId);
    return {
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role,
      tenant_id: authUser.tenantId,
      phone: profile?.phone ?? null,
      available_for_calls: profile?.available_for_calls ?? true,
      modules,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        brand_color: tenant.brand_color,
        plan_key: tenant.plan_key,
        domain: tenant.domain,
      },
    };
  }

  // Self-service "forgot password": email a one-time reset link. Never reveals
  // whether the address exists (no account enumeration), the controller always
  // responds success. An email can belong to several workspaces; each active
  // account gets its own scoped link.
  async requestPasswordReset(email?: string): Promise<void> {
    const trimmed = email?.trim();
    if (!trimmed) return;

    const candidates = await usersRepository.findByEmailWithTenants(trimmed);
    for (const user of candidates) {
      if (user.status !== "ACTIVE" || user.tenant_status !== "ACTIVE") continue;

      // The signing secret embeds the current password hash, so the link is
      // single-use (it stops verifying the moment the password changes).
      const token = signPasswordResetToken(
        { id: user.id, tenantId: user.tenant_id, type: "pwreset" },
        user.password_hash
      );
      const resetUrl = `${config.CRM_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

      void this.sendResetLinkEmail(user.tenant_id, {
        name: user.name,
        email: user.email,
        workspaceName: user.tenant_name ?? config.BRAND_NAME,
        resetUrl,
      });
    }
  }

  private async sendResetLinkEmail(
    tenantId: string,
    p: { name: string; email: string; workspaceName: string; resetUrl: string }
  ): Promise<void> {
    try {
      const { subject, html, text } = renderPasswordResetLinkEmail({
        memberName: p.name,
        memberEmail: p.email,
        workspaceName: p.workspaceName,
        resetUrl: p.resetUrl,
        expiresIn: RESET_LINK_TTL_LABEL,
      });
      const res = await mailerService.send({
        tenantId,
        category: "TRANSACTIONAL",
        to: p.email,
        subject,
        text,
        html,
      });
      logger.info(`password-reset link email to ${p.email}: provider=${res.provider}`);
    } catch (err) {
      logger.warn(`password-reset link email to ${p.email} failed: ${String(err)}`);
    }
  }

  // Complete the reset: validate the one-time token against the user's current
  // password hash, then store the new (bcrypt) hash. The token becomes unusable
  // afterwards because the hash it was signed with no longer exists.
  async resetPassword(token?: string, newPassword?: string): Promise<void> {
    if (!token || !newPassword) {
      throw new BadRequestError("A reset link and a new password are required");
    }
    if (newPassword.length < 8) {
      throw new BadRequestError("Password must be at least 8 characters");
    }

    const decoded = decodePasswordResetToken(token);
    if (!decoded?.id || !decoded.tenantId || decoded.type !== "pwreset") {
      throw new BadRequestError("This reset link is invalid. Request a new one.");
    }

    const user = await usersRepository.findById(decoded.id, decoded.tenantId);
    if (!user) throw new BadRequestError("This reset link is invalid. Request a new one.");

    try {
      verifyPasswordResetToken(token, user.password_hash);
    } catch {
      throw new BadRequestError(
        "This reset link is invalid or has expired. Request a new one."
      );
    }

    await usersRepository.update(user.id, user.tenant_id, {
      password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    });
    engineService.audit(user.tenant_id, user.id, "auth.password_reset_self", "user", user.id, {
      email: user.email,
    });
  }
}

export default new AuthService();
