import { NextFunction, Request, Response } from "express";
import { db } from "../db/connection";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { verifyTenantToken } from "../utils/jwt.util";

const parseStringArray = (value: unknown): string[] | null => {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return null;
};

export const authenticateUser = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;
  if (!authHeader) throw new UnauthorizedError("No token provided");

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new UnauthorizedError("Invalid authorization header format");
  }

  const decoded = verifyTenantToken(parts[1]);

  const row = await db
    .selectFrom("users")
    .innerJoin("tenants", "tenants.id", "users.tenant_id")
    .select([
      "users.id as user_id",
      "users.name as user_name",
      "users.email as email",
      "users.role as role",
      "users.status as user_status",
      "users.permissions as permissions",
      "tenants.id as tenant_id",
      "tenants.slug as tenant_slug",
      "tenants.name as tenant_name",
      "tenants.status as tenant_status",
      "tenants.brand_color as brand_color",
      "tenants.config as tenant_config",
    ])
    .where("users.id", "=", decoded.id)
    .where("users.tenant_id", "=", decoded.tenantId)
    .executeTakeFirst();

  if (!row) throw new UnauthorizedError("Account not found");
  if (row.user_status !== "ACTIVE") throw new UnauthorizedError("Account is not active");
  if (row.tenant_status !== "ACTIVE") {
    throw new ForbiddenError("This workspace is suspended. Contact your platform operator.");
  }

  req.authUser = {
    id: row.user_id,
    tenantId: row.tenant_id,
    name: row.user_name,
    email: row.email,
    role: row.role,
    permissions: parseStringArray(row.permissions),
    status: row.user_status,
  };
  req.tenantId = row.tenant_id;
  req.tenant = {
    id: row.tenant_id,
    slug: row.tenant_slug,
    name: row.tenant_name,
    status: row.tenant_status,
    brandColor: row.brand_color,
    config: (row.tenant_config as Record<string, unknown> | null) ?? null,
  };

  next();
};
