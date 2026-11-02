import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import contactsService from "../services/contacts.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";
import activityEventsService from "../services/activity-events.service";
import engagementService from "../services/engagement.service";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

export const listContacts = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const result = await contactsService.list(tenantId, {
    q: req.query.q as string | undefined,
    lifecycle: req.query.lifecycle as string | undefined,
  });
  sendSuccessResponse({ res, data: result });
};

export const getContact = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await contactsService.detail(tenantId, String(req.params.id)),
  });
};

export const createContact = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const contact = await contactsService.create(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: contact,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Contact created",
  });
};

export const updateContact = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await contactsService.update(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Contact updated",
  });
};

export const deleteContact = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await contactsService.remove(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Contact deleted",
  });
};

// The contact's engagement across every connected product. Product history
// follows the PERSON, so a lead that converted keeps everything it built up.
export const getContactEngagement = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await engagementService.listForPerson(tenantId, {
      leadId: null,
      contactId: String(req.params.id),
    }),
  });
};

// The contact's raw product-activity stream.
export const listContactPlatformEvents = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await activityEventsService.listForPerson(
      tenantId,
      { contactId: String(req.params.id) },
      { limit: 100 }
    ),
  });
};
