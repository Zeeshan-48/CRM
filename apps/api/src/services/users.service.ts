import bcrypt from "bcrypt";
import config from "../config";
import {
  BUILTIN_ROLE_KEYS,
  GOVERNANCE_CAPABILITIES,
  isBuiltinRole,
  isCapabilityKey,
  isElevatedRole,
  LIMIT_CODES,
  MODULE_CATALOGUE,
  MODULES,
  ROLE_MODULES,
} from "../constants/modules.const";
import type { user_status } from "../db/enums";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { isE164, normalizePhone } from "../utils/phone";
import { generateTempPassword } from "../utils/password";
import logger from "../utils/logger";
import rolesRepository from "../repositories/roles.repository";
import tenantsRepository from "../repositories/tenants.repository";
import usersRepository, { UserRow } from "../repositories/users.repository";
import { renderPasswordResetEmail } from "./email/password-reset.template";
import { renderTeamInviteEmail } from "./email/team-invite.template";
import engineService from "./engine.service";
import entitlementsService from "./entitlements.service";
import mailerService from "./mailer.service";
import rbacService from "./rbac.service";

const BCRYPT_ROUNDS = 12;

// Human-friendly label for a role key (e.g. SALES_AGENT -> "Sales Agent"),
// used in the invitation email.
const prettyRole = (role: string): string =>
  role
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ") || role;

const parseStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

// Keep only valid capability keys (feature modules + governance capabilities)
// and reject unknown keys, so a role can't be saved with typos that silently
// grant nothing.
const sanitizeCapabilities = (value: unknown[]): string[] => {
  const perms = value.filter((v): v is string => typeof v === "string");
  const invalid = perms.filter((p) => !isCapabilityKey(p));
  if (invalid.length) {
    throw new BadRequestError(`Unknown module key(s): ${invalid.join(", ")}`);
  }
  return perms;
};

const toPublicUser = async (u: UserRow) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  status: u.status,
  permissions: await rbacService.getModulesForUser({
    tenantId: u.tenant_id,
    role: u.role,
    permissions: Array.isArray(u.permissions) ? (u.permissions as string[]) : null,
  }),
  territory: parseStringArray(u.territory),
  skills: parseStringArray(u.skills),
  avatar_color: u.avatar_color,
  last_login_at: u.last_login_at,
  created_at: u.created_at,
  // Inbound call routing rings this number and skips unavailable agents, so
  // admins need to see both on the Users page.
  phone: u.phone,
  available_for_calls: u.available_for_calls,
});

class UsersService {
  async list(tenantId: string) {
    const rows = await usersRepository.findByTenant(tenantId);
    return Promise.all(rows.map(toPublicUser));
  }

  async rolesCatalogue(tenantId: string) {
    const [allRoles, counts] = await Promise.all([
      rolesRepository.findByTenant(tenantId),
      usersRepository.countsByRole(tenantId),
    ]);
    const custom = allRoles.filter((r) => !r.builtin);
    // Effective module set per built-in role = hardcoded default overlaid with
    // any per-tenant override (builtin=true rows). `customized` lists which
    // built-in roles currently deviate from their default (for the UI badge +
    // "reset to default").
    const roleModules: Record<string, string[]> = { ...ROLE_MODULES };
    const customized: string[] = [];
    for (const row of allRoles.filter((r) => r.builtin)) {
      roleModules[row.key] = Array.isArray(row.permissions)
        ? row.permissions.filter((p): p is string => typeof p === "string")
        : [];
      customized.push(row.key);
    }
    return {
      builtin: BUILTIN_ROLE_KEYS,
      modules: MODULES,
      // Governance capabilities + full metadata (label/description/group/
      // governance flag) drive the role editor's grouped picker and UI labels.
      capabilities: GOVERNANCE_CAPABILITIES,
      catalogue: MODULE_CATALOGUE,
      roleModules,
      customized,
      permissionLevels: ["module", "feature", "field", "api", "approval"],
      custom,
      // Member count per role key (built-in and custom).
      counts,
    };
  }

  // A per-user permission list overrides the role entirely, so it is as strong
  // as a role assignment: only an admin may set one, and it may hold only real
  // module or capability keys (never the "*" wildcard).
  private checkPermissionOverride(actorRole: string, value: unknown): string[] | null {
    if (value === null || value === undefined) return null;
    if (actorRole !== "ADMIN") {
      throw new ForbiddenError("Only an admin can set per-user permissions.");
    }
    if (!Array.isArray(value)) throw new BadRequestError("permissions must be an array");
    return sanitizeCapabilities(value);
  }

  async create(
    tenantId: string,
    actorId: string,
    actorRole: string,
    body: {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      permissions?: string[];
      territory?: string[];
      skills?: string[];
    }
  ) {
    const { name, email, role, password, permissions, territory, skills } = body;
    if (!name || !email || !role) throw new BadRequestError("name, email and role are required");

    // Only an admin can invite an elevated (admin/manager) user.
    if (isElevatedRole(role) && actorRole !== "ADMIN") {
      throw new ForbiddenError("Only an admin can invite an admin or manager.");
    }

    const perms = this.checkPermissionOverride(actorRole, permissions);

    if (!isBuiltinRole(role) && !perms) {
      const customRole = await rolesRepository.findByKey(tenantId, role);
      if (!customRole) throw new BadRequestError("Unknown role");
    }

    if (await usersRepository.emailExistsInTenant(tenantId, email)) {
      throw new ConflictError("Email already in use");
    }

    const currentSeats = await usersRepository.countByTenant(tenantId);
    await entitlementsService.ensureCapacity(tenantId, LIMIT_CODES.SEATS, currentSeats, 1, "seat");

    // When the admin doesn't set a password we generate a secure random one and
    // email it to the member. (Previously this fell back to a shared default.)
    const providedPassword = typeof password === "string" ? password.trim() : "";
    const plainPassword = providedPassword || generateTempPassword();

    const user = await usersRepository.create({
      tenant_id: tenantId,
      name,
      email,
      password_hash: await bcrypt.hash(plainPassword, BCRYPT_ROUNDS),
      role,
      permissions: perms,
      territory: territory ?? null,
      skills: skills ?? null,
    });

    engineService.audit(tenantId, actorId, "user.created", "user", user.id, { role });

    // Invitation email with sign-in credentials. Fire-and-forget: a mail hiccup
    // must never fail the invite. Only dispatched when email transport is
    // actually configured (SES keyed), otherwise there is nothing to send and
    // the test runner / unconfigured dev stays a pure no-op.
    const emailed = mailerService.isLive();
    if (emailed) {
      void this.sendInviteEmail(tenantId, actorId, {
        name,
        email,
        role,
        tempPassword: plainPassword,
      });
    }

    return { ...(await toPublicUser(user)), emailed };
  }

  // Best-effort team-invite email. Never throws; logs the outcome.
  private async sendInviteEmail(
    tenantId: string,
    actorId: string,
    p: { name: string; email: string; role: string; tempPassword: string }
  ): Promise<void> {
    try {
      const [tenant, inviter] = await Promise.all([
        tenantsRepository.findById(tenantId),
        usersRepository.findById(actorId, tenantId),
      ]);
      const { subject, html, text } = renderTeamInviteEmail({
        memberName: p.name,
        memberEmail: p.email,
        tempPassword: p.tempPassword,
        workspaceName: tenant?.name ?? config.BRAND_NAME,
        roleLabel: prettyRole(p.role),
        inviterName: inviter?.name ?? null,
        loginUrl: config.CRM_APP_URL,
      });
      const res = await mailerService.send({
        tenantId,
        category: "TRANSACTIONAL",
        to: p.email,
        subject,
        text,
        html,
      });
      logger.info(`team invite email to ${p.email}: provider=${res.provider}`);
    } catch (err) {
      logger.warn(`team invite email to ${p.email} failed: ${String(err)}`);
    }
  }

  // Admin-initiated password reset: generates a new random password, stores its
  // hash, and emails the new credentials to the member. The plaintext is never
  // returned by the API, it is only delivered by email (matching the invite
  // flow). Returns whether the email was actually dispatched so the caller can
  // warn when mail transport is unconfigured.
  async resetPassword(
    tenantId: string,
    actorId: string,
    userId: string
  ): Promise<{ ok: true; email: string; emailed: boolean }> {
    if (userId === actorId) {
      throw new BadRequestError(
        "Use your profile page to change your own password"
      );
    }

    const user = await usersRepository.findById(userId, tenantId);
    if (!user) throw new NotFoundError("User not found");

    const plainPassword = generateTempPassword();
    const updated = await usersRepository.update(userId, tenantId, {
      password_hash: await bcrypt.hash(plainPassword, BCRYPT_ROUNDS),
    });
    if (!updated) throw new NotFoundError("User not found");

    engineService.audit(tenantId, actorId, "user.password_reset", "user", userId, {
      email: user.email,
    });

    // Deliver the new credentials by email (best-effort, only when configured).
    const emailed = mailerService.isLive();
    if (emailed) {
      void this.sendResetEmail(tenantId, actorId, {
        name: user.name,
        email: user.email,
        tempPassword: plainPassword,
      });
    }

    return { ok: true, email: user.email, emailed };
  }

  // Best-effort admin password-reset email. Never throws; logs the outcome.
  private async sendResetEmail(
    tenantId: string,
    actorId: string,
    p: { name: string; email: string; tempPassword: string }
  ): Promise<void> {
    try {
      const [tenant, resetter] = await Promise.all([
        tenantsRepository.findById(tenantId),
        usersRepository.findById(actorId, tenantId),
      ]);
      const { subject, html, text } = renderPasswordResetEmail({
        memberName: p.name,
        memberEmail: p.email,
        tempPassword: p.tempPassword,
        workspaceName: tenant?.name ?? config.BRAND_NAME,
        resetByName: resetter?.name ?? null,
        loginUrl: config.CRM_APP_URL,
      });
      const res = await mailerService.send({
        tenantId,
        category: "TRANSACTIONAL",
        to: p.email,
        subject,
        text,
        html,
      });
      logger.info(`password reset email to ${p.email}: provider=${res.provider}`);
    } catch (err) {
      logger.warn(`password reset email to ${p.email} failed: ${String(err)}`);
    }
  }

  async update(
    tenantId: string,
    actorId: string,
    actorRole: string,
    userId: string,
    body: Partial<{
      name: string;
      role: string;
      status: user_status;
      permissions: string[] | null;
      territory: string[] | null;
      skills: string[] | null;
      phone: string | null;
    }>
  ) {
    const existing = await usersRepository.findById(userId, tenantId);
    if (!existing) throw new NotFoundError("User not found");

    // Only an admin may touch an elevated (admin/manager) user, or promote
    // anyone INTO an elevated role.
    if (actorRole !== "ADMIN") {
      if (isElevatedRole(existing.role)) {
        throw new ForbiddenError("Only an admin can modify an admin or manager.");
      }
      if (body.role !== undefined && isElevatedRole(body.role)) {
        throw new ForbiddenError("Only an admin can assign the admin or manager role.");
      }
    }

    if (body.permissions !== undefined) {
      body = { ...body, permissions: this.checkPermissionOverride(actorRole, body.permissions) };
    }

    // Role reassignment: the target must be a built-in or an existing custom
    // role in this tenant (never an arbitrary string).
    if (body.role !== undefined && !isBuiltinRole(body.role)) {
      const custom = await rolesRepository.findByKey(tenantId, body.role);
      if (!custom) throw new BadRequestError("Unknown role");
    }

    // Same normalization contract as the self-service path: bare national
    // numbers pick up the default country code; empty clears.
    const patch = { ...body };
    if (patch.phone !== undefined) {
      const raw = String(patch.phone ?? "").trim();
      const phone = raw ? normalizePhone(raw) : "";
      if (phone && !isE164(phone)) {
        throw new BadRequestError("Enter the number in international format, e.g. +919876543210");
      }
      patch.phone = phone || null;
    }

    const updated = await usersRepository.update(userId, tenantId, patch);
    if (!updated) throw new NotFoundError("User not found");

    engineService.audit(tenantId, actorId, "user.updated", "user", userId, body);
    return toPublicUser(updated);
  }

  // Self-service: a user sets their own callback (mobile) number for click-to-
  // call. No role gate. Empty string clears it.
  async updateOwnProfile(tenantId: string, userId: string, body: { phone?: string }) {
    const raw = String(body.phone ?? "").trim();
    const phone = raw ? normalizePhone(raw) : "";
    if (phone && !isE164(phone)) {
      throw new BadRequestError("Enter your number in international format, e.g. +14155550123");
    }
    const updated = await usersRepository.update(userId, tenantId, { phone: phone || null });
    if (!updated) throw new NotFoundError("User not found");
    return { phone: updated.phone };
  }

  // Self-service: a user changes their own password. Requires the current
  // password (verified against the stored hash) and enforces a minimum length.
  async changeOwnPassword(
    tenantId: string,
    userId: string,
    body: { currentPassword?: string; newPassword?: string }
  ): Promise<{ ok: true }> {
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    if (!currentPassword || !newPassword) {
      throw new BadRequestError("Current and new password are required");
    }
    if (newPassword.length < 8) {
      throw new BadRequestError("New password must be at least 8 characters");
    }
    if (currentPassword === newPassword) {
      throw new BadRequestError("New password must differ from the current password");
    }

    const user = await usersRepository.findById(userId, tenantId);
    if (!user) throw new NotFoundError("User not found");

    const ok = await bcrypt.compare(currentPassword, user.password_hash);
    if (!ok) throw new BadRequestError("Current password is incorrect");

    await usersRepository.update(userId, tenantId, {
      password_hash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
    });
    engineService.audit(tenantId, userId, "user.password_changed", "user", userId);
    return { ok: true };
  }

  // Remove a user from the workspace. Guards: you can't delete yourself; only
  // an admin can remove an admin; the last admin can never be removed. Before
  // deleting, the user's owned work is round-robin reassigned to the remaining
  // active users so nothing is orphaned, and a report of what moved (and to
  // whom) is returned.
  async deleteUser(tenantId: string, actor: { id: string; role: string }, targetId: string) {
    const target = await usersRepository.findById(targetId, tenantId);
    if (!target) throw new NotFoundError("User not found");

    if (target.id === actor.id) {
      throw new BadRequestError("You can't delete your own account.");
    }
    // Only an admin can remove an elevated (admin/manager) user.
    if (isElevatedRole(target.role) && actor.role !== "ADMIN") {
      throw new ForbiddenError("Only an admin can remove an admin or manager.");
    }
    if (target.role === "ADMIN") {
      const adminCount = await usersRepository.countByRole(tenantId, "ADMIN");
      if (adminCount <= 1) {
        throw new BadRequestError("You can't remove the last admin of the workspace.");
      }
    }

    // Reassignment pool: the remaining ACTIVE users (never the target).
    const others = (await usersRepository.findByTenant(tenantId)).filter(
      (u) => u.id !== targetId && u.status === "ACTIVE"
    );
    const poolIds = others.map((u) => u.id);

    const reassigned = await usersRepository.reassignOwnership(tenantId, targetId, poolIds);
    const cleaned = await usersRepository.purgePersonal(tenantId, targetId);
    await usersRepository.delete(targetId, tenantId);

    engineService.audit(tenantId, actor.id, "user.deleted", "user", targetId, {
      email: target.email,
      role: target.role,
      reassigned,
      cleaned,
    });

    // Turn the raw per-user id counts into a readable, named report.
    const nameById = new Map(others.map((u) => [u.id, u.name]));
    const distribution = (perUser: Record<string, number>) =>
      Object.entries(perUser).map(([id, count]) => ({
        id,
        name: nameById.get(id) ?? "Unknown",
        count,
      }));
    const reassignedReport = Object.fromEntries(
      Object.entries(reassigned).map(([entity, r]) => [
        entity,
        { total: r.total, unassigned: r.unassigned, distribution: distribution(r.perUser) },
      ])
    );
    const totalReassigned = Object.values(reassigned).reduce(
      (sum, r) => sum + (r.total - r.unassigned),
      0
    );

    return {
      deleted: { id: target.id, name: target.name, email: target.email, role: target.role },
      reassignedAmong: others.map((u) => ({ id: u.id, name: u.name })),
      totalReassigned,
      reassigned: reassignedReport,
      cleaned,
    };
  }

  async createCustomRole(
    tenantId: string,
    actorId: string,
    body: { name?: string; permissions?: unknown }
  ) {
    const { name, permissions } = body;
    if (!name || !Array.isArray(permissions)) {
      throw new BadRequestError("name and permissions[] required");
    }
    const key = name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!key) throw new BadRequestError("Could not derive a role key from the name");
    if (isBuiltinRole(key)) throw new ConflictError("Role key collides with a built-in role");
    if (await rolesRepository.findByKey(tenantId, key)) {
      throw new ConflictError("A role with this name already exists");
    }

    const perms = sanitizeCapabilities(permissions);

    const role = await rolesRepository.create({
      tenant_id: tenantId,
      key,
      name,
      permissions: perms,
    });
    engineService.audit(tenantId, actorId, "role.created", "role", role.id, { key });
    rbacService.invalidate(tenantId);
    return role;
  }

  // Edit a role's module set. Works for BOTH custom roles and built-in roles:
  //  - custom  -> update its row (name + permissions).
  //  - built-in -> upsert a per-tenant OVERRIDE row (builtin=true). The role key
  //    is immutable and built-in display names stay fixed, so only the module
  //    set changes. ADMIN is the superuser role and is never editable (it has
  //    full access; editing it could lock the workspace out).
  async updateRole(
    tenantId: string,
    actorId: string,
    actorRole: string,
    key: string,
    body: { name?: string; permissions?: unknown }
  ) {
    // Only an admin can edit the module set of an elevated (admin/manager) role.
    if (isElevatedRole(key) && actorRole !== "ADMIN") {
      throw new ForbiddenError("Only an admin can edit the admin or manager role.");
    }
    if (isBuiltinRole(key)) {
      if (key === "ADMIN") {
        throw new BadRequestError("The Admin role has full access and can't be edited.");
      }
      if (!Array.isArray(body.permissions)) {
        throw new BadRequestError("permissions[] required");
      }
      const perms = sanitizeCapabilities(body.permissions);
      const existing = await rolesRepository.findByKey(tenantId, key);
      const role = existing
        ? await rolesRepository.update(tenantId, key, { permissions: perms })
        : await rolesRepository.create({
            tenant_id: tenantId,
            key,
            name: prettyRole(key),
            permissions: perms,
            builtin: true,
          });
      if (!role) throw new NotFoundError("Role not found");
      engineService.audit(tenantId, actorId, "role.updated", "role", role.id, {
        key,
        builtin: true,
      });
      rbacService.invalidate(tenantId);
      return role;
    }

    const existing = await rolesRepository.findByKey(tenantId, key);
    if (!existing || existing.builtin) throw new NotFoundError("Role not found");

    const patch: { name?: string; permissions?: string[] } = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) throw new BadRequestError("Role name cannot be empty");
      patch.name = name;
    }
    if (body.permissions !== undefined) {
      if (!Array.isArray(body.permissions)) throw new BadRequestError("permissions[] required");
      patch.permissions = sanitizeCapabilities(body.permissions);
    }
    if (patch.name === undefined && patch.permissions === undefined) {
      throw new BadRequestError("Nothing to update");
    }

    const role = await rolesRepository.update(tenantId, key, patch);
    if (!role) throw new NotFoundError("Role not found");
    engineService.audit(tenantId, actorId, "role.updated", "role", role.id, { key });
    rbacService.invalidate(tenantId);
    return role;
  }

  // For a custom role: delete it (blocked while any user still holds it, so no
  // user is silently left without a role). For a built-in role: "delete" means
  // RESET TO DEFAULT, drop the per-tenant override so it reverts to the
  // hardcoded default (safe even while users hold it).
  async deleteRole(tenantId: string, actorId: string, actorRole: string, key: string) {
    // Only an admin can reset an elevated (admin/manager) role to its default.
    if (isElevatedRole(key) && actorRole !== "ADMIN") {
      throw new ForbiddenError("Only an admin can reset the admin or manager role.");
    }
    if (isBuiltinRole(key)) {
      const existing = await rolesRepository.findByKey(tenantId, key);
      if (!existing) {
        throw new BadRequestError("This role already uses its default access.");
      }
      await rolesRepository.delete(tenantId, key);
      engineService.audit(tenantId, actorId, "role.reset", "role", existing.id, { key });
      rbacService.invalidate(tenantId);
      return { ok: true as const, reset: true };
    }

    const existing = await rolesRepository.findByKey(tenantId, key);
    if (!existing || existing.builtin) throw new NotFoundError("Role not found");

    const inUse = await usersRepository.countByRole(tenantId, key);
    if (inUse > 0) {
      throw new ConflictError(
        `${inUse} user${inUse === 1 ? "" : "s"} still ${
          inUse === 1 ? "has" : "have"
        } this role, reassign them before deleting it.`
      );
    }

    await rolesRepository.delete(tenantId, key);
    engineService.audit(tenantId, actorId, "role.deleted", "role", existing.id, { key });
    rbacService.invalidate(tenantId);
    return { ok: true as const, reset: false };
  }
}

export default new UsersService();
