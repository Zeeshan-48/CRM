import bcrypt from "bcrypt";
import config from "../../config";
import { BadRequestError, UnauthorizedError } from "../../errors";
import operatorsRepository from "../../repositories/operator/operators.repository";
import {
  decodeOperatorPasswordResetToken,
  signOperatorPasswordResetToken,
  signOperatorToken,
  verifyOperatorPasswordResetToken,
} from "../../utils/jwt.util";
import logger from "../../utils/logger";
import auditService from "./audit.service";
import emailService from "./email.service";
import { renderOperatorPasswordResetLinkEmail } from "./email/password-reset-link.template";

const BCRYPT_ROUNDS = 12;
// Keep in sync with the JWT expiry in signOperatorPasswordResetToken.
const RESET_LINK_TTL_LABEL = "1 hour";

export interface PublicOperator {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: Date | null;
  created_at: Date;
}

const toPublic = (row: {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: Date | null;
  created_at: Date;
}): PublicOperator => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  status: row.status,
  last_login_at: row.last_login_at,
  created_at: row.created_at,
});

class AuthService {
  async login(email?: string, password?: string): Promise<{ token: string; user: PublicOperator }> {
    if (!email || !password) throw new BadRequestError("Email and password are required");

    const operator = await operatorsRepository.findByEmail(email);
    if (!operator) throw new UnauthorizedError("Invalid email or password");

    const ok = await bcrypt.compare(password, operator.password_hash);
    if (!ok) throw new UnauthorizedError("Invalid email or password");
    if (operator.status !== "ACTIVE") throw new UnauthorizedError("Account is not active");

    const token = signOperatorToken({ id: operator.id, role: operator.role, type: "operator" });

    operatorsRepository.touchLastLogin(operator.id);
    auditService.log({ id: operator.id, email: operator.email }, "auth.login", "auth", {
      resourceId: operator.id,
      summary: `${operator.email} signed in to the operator console`,
    });

    return { token, user: toPublic(operator) };
  }

  async me(operatorId: string): Promise<PublicOperator> {
    const operator = await operatorsRepository.findById(operatorId);
    if (!operator) throw new UnauthorizedError("Account not found");
    return toPublic(operator);
  }

  // Self-service "forgot password": email a one-time reset link. Never reveals
  // whether the address maps to an operator (the controller always responds
  // success), so it can't be used to enumerate operator accounts.
  async requestPasswordReset(email?: string): Promise<void> {
    const trimmed = email?.trim();
    if (!trimmed) return;

    const operator = await operatorsRepository.findByEmail(trimmed);
    if (!operator || operator.status !== "ACTIVE") return;

    // The signing secret embeds the current password hash, so the link is
    // single-use (it stops verifying the moment the password changes).
    const token = signOperatorPasswordResetToken(
      { id: operator.id, type: "op-pwreset" },
      operator.password_hash
    );
    const resetUrl = `${config.OPERATOR_APP_URL}/reset-password?token=${encodeURIComponent(token)}`;

    void this.sendResetLinkEmail({
      name: operator.name,
      email: operator.email,
      resetUrl,
    });
  }

  private async sendResetLinkEmail(p: {
    name: string;
    email: string;
    resetUrl: string;
  }): Promise<void> {
    try {
      const { subject, html, text } = renderOperatorPasswordResetLinkEmail({
        operatorName: p.name,
        operatorEmail: p.email,
        resetUrl: p.resetUrl,
        expiresIn: RESET_LINK_TTL_LABEL,
      });
      const res = await emailService.send({ to: p.email, subject, html, text });
      logger.info(`operator password-reset link to ${p.email}: sent=${res.sent}`);
    } catch (err) {
      logger.warn(`operator password-reset link to ${p.email} failed: ${String(err)}`);
    }
  }

  // Complete the reset: validate the one-time token against the operator's
  // current password hash, then store the new (bcrypt) hash. The token becomes
  // unusable afterwards because the hash it was signed with no longer exists.
  async resetPassword(token?: string, newPassword?: string): Promise<void> {
    if (!token || !newPassword) {
      throw new BadRequestError("A reset link and a new password are required");
    }
    if (newPassword.length < 8) {
      throw new BadRequestError("Password must be at least 8 characters");
    }

    const decoded = decodeOperatorPasswordResetToken(token);
    if (!decoded?.id || decoded.type !== "op-pwreset") {
      throw new BadRequestError("This reset link is invalid. Request a new one.");
    }

    const operator = await operatorsRepository.findById(decoded.id);
    if (!operator) throw new BadRequestError("This reset link is invalid. Request a new one.");

    try {
      verifyOperatorPasswordResetToken(token, operator.password_hash);
    } catch {
      throw new BadRequestError(
        "This reset link is invalid or has expired. Request a new one."
      );
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await operatorsRepository.updatePassword(operator.id, passwordHash);

    auditService.log(
      { id: operator.id, email: operator.email },
      "auth.password_reset_self",
      "auth",
      {
        resourceId: operator.id,
        summary: `${operator.email} reset their password via a reset link`,
      }
    );
  }

  async changePassword(
    operatorId: string,
    currentPassword?: string,
    newPassword?: string
  ): Promise<void> {
    if (!currentPassword || !newPassword) {
      throw new BadRequestError("Current and new password are required");
    }
    if (newPassword.length < 8) {
      throw new BadRequestError("New password must be at least 8 characters");
    }

    const operator = await operatorsRepository.findById(operatorId);
    if (!operator) throw new UnauthorizedError("Account not found");

    const ok = await bcrypt.compare(currentPassword, operator.password_hash);
    if (!ok) throw new UnauthorizedError("Current password is incorrect");

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await operatorsRepository.updatePassword(operatorId, passwordHash);

    auditService.log({ id: operator.id, email: operator.email }, "auth.password_changed", "auth", {
      resourceId: operator.id,
      summary: `${operator.email} changed their password`,
    });
  }
}

export default new AuthService();
