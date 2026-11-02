import { NextFunction, Request, Response } from "express";
import { db } from "../db/connection";
import { ForbiddenError, UnauthorizedError } from "../errors";
import { verifyOperatorToken } from "../utils/jwt.util";

export const authenticateOperator = async (
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

  const decoded = verifyOperatorToken(parts[1]);

  const row = await db
    .selectFrom("operator_users")
    .select(["id", "email", "name", "role", "status"])
    .where("id", "=", decoded.id)
    .executeTakeFirst();

  if (!row) throw new UnauthorizedError("Account not found");
  if (row.status !== "ACTIVE") throw new UnauthorizedError("Account is not active");

  req.operatorUser = {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
  };

  next();
};

export const requireSuperadmin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (!req.operatorUser) throw new UnauthorizedError("Authentication required");
  if (req.operatorUser.role !== "SUPERADMIN") {
    throw new ForbiddenError("SUPERADMIN role required");
  }
  next();
};
