import bcrypt from "bcrypt";
import { operator_role, user_status } from "../../db/enums";
import { BadRequestError, ConflictError, NotFoundError } from "../../errors";
import operatorsRepository, { PublicOperatorRow } from "../../repositories/operator/operators.repository";
import logger from "../../utils/logger";
import { generateTempPassword } from "../../utils/password";
import auditService, { AuditActor } from "./audit.service";
import { renderOperatorInviteEmail } from "./email/operator-invite.template";
import emailService from "./email.service";

const BCRYPT_ROUNDS = 12;

export interface CreateOperatorResult extends PublicOperatorRow {
  // Whether the invite email actually went out.
  emailed: boolean;
  // Only populated when we generated the password AND could not email it, // otherwise the new operator would have no way to sign in. Never echoes a
  // password the caller supplied themselves.
  tempPassword?: string;
}

const isOperatorRole = (value: string): value is operator_role =>
  Object.values(operator_role).includes(value as operator_role);

const isUserStatus = (value: string): value is user_status =>
  Object.values(user_status).includes(value as user_status);

class OperatorsService {
  async list(): Promise<PublicOperatorRow[]> {
    return operatorsRepository.list();
  }

  async create(
    actor: AuditActor,
    body: { name?: string; email?: string; role?: string; password?: string }
  ): Promise<CreateOperatorResult> {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const role = typeof body.role === "string" ? body.role : "";
    if (!name) throw new BadRequestError("Name is required");
    if (!email) throw new BadRequestError("Email is required");
    if (!isOperatorRole(role)) {
      throw new BadRequestError(
        `Invalid role: must be one of ${Object.values(operator_role).join(", ")}`
      );
    }

    const existing = await operatorsRepository.findByEmail(email);
    if (existing) throw new ConflictError(`Operator with email ${email} already exists`);

    // When the superadmin doesn't set a password we generate a secure random one
    // and email it. (Previously this fell back to a shared default.)
    const providedPassword = typeof body.password === "string" ? body.password.trim() : "";
    const generated = !providedPassword;
    const plainPassword = providedPassword || generateTempPassword();

    const passwordHash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    const created = await operatorsRepository.create({ name, email, role, passwordHash });

    auditService.log(actor, "operator.created", "operators", {
      resourceId: created.id,
      summary: `${actor.email} created operator ${email} with role ${role}`,
      metadata: { name, email, role },
    });

    // Fire-and-forget: a mail hiccup must never fail the create.
    const emailed = emailService.isConfigured();
    if (emailed) {
      void this.sendInviteEmail({ name, email, role, tempPassword: plainPassword });
    }

    // Without email transport a generated password would be lost and the new
    // operator could never sign in, so hand it back to the superadmin (who is
    // already authenticated over TLS) to convey out of band.
    return {
      ...created,
      emailed,
      ...(generated && !emailed ? { tempPassword: plainPassword } : {}),
    };
  }

  private async sendInviteEmail(params: {
    name: string;
    email: string;
    role: string;
    tempPassword: string;
  }): Promise<void> {
    const rendered = renderOperatorInviteEmail({
      operatorName: params.name,
      operatorEmail: params.email,
      role: params.role,
      tempPassword: params.tempPassword,
    });
    const result = await emailService.send({ to: params.email, ...rendered });
    if (!result.sent) {
      logger.warn(`operator invite email to ${params.email} not sent: ${result.error ?? "skipped"}`);
    }
  }

  async update(
    actor: AuditActor,
    id: string,
    body: { name?: string; role?: string; status?: string }
  ): Promise<PublicOperatorRow> {
    const patch: { name?: string; role?: operator_role; status?: user_status } = {};
    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) throw new BadRequestError("Name cannot be empty");
      patch.name = name;
    }
    if (body.role !== undefined) {
      if (typeof body.role !== "string" || !isOperatorRole(body.role)) {
        throw new BadRequestError(
          `Invalid role: must be one of ${Object.values(operator_role).join(", ")}`
        );
      }
      patch.role = body.role;
    }
    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !isUserStatus(body.status)) {
        throw new BadRequestError(
          `Invalid status: must be one of ${Object.values(user_status).join(", ")}`
        );
      }
      patch.status = body.status;
    }
    if (!Object.keys(patch).length) throw new BadRequestError("Nothing to update");

    const updated = await operatorsRepository.update(id, patch);
    if (!updated) throw new NotFoundError("Operator not found");

    auditService.log(actor, "operator.updated", "operators", {
      resourceId: updated.id,
      summary: `${actor.email} updated operator ${updated.email}`,
      metadata: { ...patch },
    });
    return updated;
  }
}

export default new OperatorsService();
