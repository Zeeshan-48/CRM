import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import usersService from "../services/users.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

export const listUsers = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await usersService.list(tenantId) });
};

export const rolesCatalogue = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await usersService.rolesCatalogue(tenantId) });
};

export const createUser = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  const user = await usersService.create(tenantId, actorId, actorRole, req.body ?? {});
  sendSuccessResponse({
    res,
    data: user,
    statusCode: HttpSuccessStatus.CREATED,
    message: "User created",
  });
};

export const updateUser = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  const user = await usersService.update(
    tenantId,
    actorId,
    actorRole,
    String(req.params.id),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: user, message: "User updated" });
};

export const deleteUser = async (req: Request, res: Response) => {
  const actor = req.authUser;
  if (!actor) throw new ForbiddenError("Tenant context required");
  const data = await usersService.deleteUser(
    actor.tenantId,
    { id: actor.id, role: actor.role },
    String(req.params.id)
  );
  sendSuccessResponse({ res, data, message: `${data.deleted.name} removed from the workspace` });
};

export const resetUserPassword = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const data = await usersService.resetPassword(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({
    res,
    data,
    message: data.emailed
      ? "Password reset, new credentials emailed to the member"
      : "Password reset (email transport not configured)",
  });
};

export const updateMyProfile = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const data = await usersService.updateOwnProfile(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({ res, data, message: "Profile updated" });
};

export const changeMyPassword = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const data = await usersService.changeOwnPassword(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({ res, data, message: "Password updated" });
};

export const createRole = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const role = await usersService.createCustomRole(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: role,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Role created",
  });
};

export const updateRole = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  const role = await usersService.updateRole(
    tenantId,
    actorId,
    actorRole,
    String(req.params.key),
    req.body ?? {}
  );
  sendSuccessResponse({ res, data: role, message: "Role updated" });
};

export const deleteRole = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  const data = await usersService.deleteRole(tenantId, actorId, actorRole, String(req.params.key));
  sendSuccessResponse({
    res,
    data,
    message: data.reset ? "Role reset to default" : "Role deleted",
  });
};
