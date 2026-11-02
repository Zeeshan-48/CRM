import jwt from "jsonwebtoken";
import config from "../config";
import { UnauthorizedError } from "../errors";

export interface TenantTokenPayload {
  id: string;
  tenantId: string;
  role: string;
  type: "tenant";
}

export const signTenantToken = (payload: TenantTokenPayload): string => {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRY as jwt.SignOptions["expiresIn"],
  });
};

export const verifyTenantToken = (token: string): TenantTokenPayload => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
  const payload = decoded as Partial<TenantTokenPayload>;
  if (!payload || payload.type !== "tenant" || !payload.id || !payload.tenantId) {
    throw new UnauthorizedError("Invalid token type");
  }
  return payload as TenantTokenPayload;
};

// --- Password-reset tokens (self-service "forgot password") ---
// Stateless and single-use WITHOUT a DB table: the signing secret is
// JWT_SECRET + the user's CURRENT password hash. Once the password changes the
// hash changes, so a spent (or stale) token can never verify again. Short TTL.
export interface PasswordResetPayload {
  id: string;
  tenantId: string;
  type: "pwreset";
}

const resetSecret = (passwordHash: string): string => `${config.JWT_SECRET}.${passwordHash}`;

export const signPasswordResetToken = (
  payload: PasswordResetPayload,
  passwordHash: string
): string => {
  return jwt.sign(payload, resetSecret(passwordHash), { expiresIn: "1h" });
};

// Read the (unverified) payload so the caller can look up the user and its
// current password hash before verifying the signature.
export const decodePasswordResetToken = (
  token: string
): Partial<PasswordResetPayload> | null => {
  const decoded = jwt.decode(token);
  return decoded && typeof decoded === "object"
    ? (decoded as Partial<PasswordResetPayload>)
    : null;
};

// Verify signature + expiry against the user's current password hash. Throws
// (caught by the caller) when the link is invalid, expired or already used.
export const verifyPasswordResetToken = (token: string, passwordHash: string): PasswordResetPayload => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, resetSecret(passwordHash));
  } catch {
    throw new UnauthorizedError("Invalid or expired reset link");
  }
  const payload = decoded as Partial<PasswordResetPayload>;
  if (!payload || payload.type !== "pwreset" || !payload.id || !payload.tenantId) {
    throw new UnauthorizedError("Invalid reset link");
  }
  return payload as PasswordResetPayload;
};

// Operator (platform-admin) reset token. Same password-hash-bound, single-use,
// short-TTL scheme as the tenant one, but with no tenant scope.
export interface OperatorPasswordResetPayload {
  id: string;
  type: "op-pwreset";
}

export const signOperatorPasswordResetToken = (
  payload: OperatorPasswordResetPayload,
  passwordHash: string
): string => {
  return jwt.sign(payload, resetSecret(passwordHash), { expiresIn: "1h" });
};

export const decodeOperatorPasswordResetToken = (
  token: string
): Partial<OperatorPasswordResetPayload> | null => {
  const decoded = jwt.decode(token);
  return decoded && typeof decoded === "object"
    ? (decoded as Partial<OperatorPasswordResetPayload>)
    : null;
};

export const verifyOperatorPasswordResetToken = (
  token: string,
  passwordHash: string
): OperatorPasswordResetPayload => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, resetSecret(passwordHash));
  } catch {
    throw new UnauthorizedError("Invalid or expired reset link");
  }
  const payload = decoded as Partial<OperatorPasswordResetPayload>;
  if (!payload || payload.type !== "op-pwreset" || !payload.id) {
    throw new UnauthorizedError("Invalid reset link");
  }
  return payload as OperatorPasswordResetPayload;
};

// --- Operator console tokens (platform tier) ---
// Distinct payload shape and `type` discriminator from tenant tokens, so the
// two verifiers never accept each other's tokens even though both are signed
// with the same JWT_SECRET.
export interface OperatorTokenPayload {
  id: string;
  role: string;
  type: "operator";
}

export const signOperatorToken = (payload: OperatorTokenPayload): string => {
  return jwt.sign(payload, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRY as jwt.SignOptions["expiresIn"],
  });
};

export const verifyOperatorToken = (token: string): OperatorTokenPayload => {
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, config.JWT_SECRET);
  } catch {
    throw new UnauthorizedError("Invalid or expired token");
  }
  const payload = decoded as Partial<OperatorTokenPayload>;
  if (!payload || payload.type !== "operator" || !payload.id) {
    throw new UnauthorizedError("Invalid token type");
  }
  return payload as OperatorTokenPayload;
};
