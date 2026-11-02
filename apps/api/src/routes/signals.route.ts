import { Request, Response, Router } from "express";
import { ForbiddenError } from "../errors";
import engagementService from "../services/engagement.service";
import { asyncHandler } from "../utils/asynchandler";
import { sendSuccessResponse } from "../utils/response.util";

// The signals feed: every person showing product intent right now, hottest
// first. This is the PQL inbox an agent works from at the start of the day.
//
// Small enough to keep its controller inline rather than spawning a file for two
// handlers; the heavy lifting lives in engagement.service.
const router = Router();

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

const qs = (req: Request, key: string): string | undefined => {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = ctx(req);
    const limitRaw = Number(qs(req, "limit"));
    sendSuccessResponse({
      res,
      data: await engagementService.signals(tenantId, {
        appId: qs(req, "app_id"),
        band: qs(req, "band")?.toUpperCase(),
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      }),
    });
  })
);

export default router;
