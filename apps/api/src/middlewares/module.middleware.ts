import { NextFunction, Request, Response } from "express";
import { ModuleKey } from "../constants/modules.const";
import { ForbiddenError, UnauthorizedError } from "../errors";
import entitlementsService from "../services/entitlements.service";
import rbacService from "../services/rbac.service";

// Two gates, in order: what the tenant bought (entitlement), then what the
// user's role allows (RBAC). ADMIN bypasses RBAC but never the entitlement.
export const requireModule = (moduleKey: ModuleKey) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.authUser;
    if (!user) throw new UnauthorizedError("Authentication required");

    await entitlementsService.ensureModuleEnabled(user.tenantId, moduleKey);

    const allowed = await rbacService.canAccessModule(user, moduleKey);
    if (!allowed) {
      throw new ForbiddenError(`You do not have access to the ${moduleKey} module`);
    }
    next();
  };
};

export const requireRole = (...roles: string[]) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.authUser;
    if (!user) throw new UnauthorizedError("Authentication required");
    if (!roles.includes(user.role)) {
      throw new ForbiddenError("Your role does not allow this action");
    }
    next();
  };
};

// RBAC-only gate for a governance capability (channels, team, billing,
// settings). Unlike requireModule there is NO entitlement check, these admin/
// setup surfaces exist in every workspace and are governed purely by the user's
// role (built-in default or custom-role permissions). Access is decided by
// rbacService, so "*" (ADMIN) and any role holding the capability both pass.
export const requireCapability = (capability: string) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.authUser;
    if (!user) throw new UnauthorizedError("Authentication required");
    const allowed = await rbacService.canAccessModule(user, capability);
    if (!allowed) {
      throw new ForbiddenError("Your role does not allow this action");
    }
    next();
  };
};
