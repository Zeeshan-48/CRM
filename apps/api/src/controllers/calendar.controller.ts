import { Request, Response } from "express";
import config from "../config";
import { BadRequestError, ForbiddenError } from "../errors";
import calendarService from "../services/calendar.service";
import googleCalendarService from "../services/google-calendar.service";
import logger from "../utils/logger";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id, actorRole: user.role };
};

export const listProviders = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await calendarService.providers(tenantId, actorId) });
};

// ---- Google Calendar OAuth (per-user) ----

// Returns the Google consent URL for the current user to open. The signed state
// carries tenant+user so the (public) callback can attribute the tokens.
export const googleConnect = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  if (!googleCalendarService.isEnabled()) {
    throw new BadRequestError("Google Calendar integration is not configured");
  }
  const url = googleCalendarService.getAuthUrl(tenantId, actorId);
  sendSuccessResponse({ res, data: { url } });
};

export const googleStatus = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const status = googleCalendarService.isEnabled()
    ? await googleCalendarService.status(tenantId, actorId)
    : { connected: false, email: null, status: null };
  sendSuccessResponse({ res, data: { ...status, available: googleCalendarService.isEnabled() } });
};

export const googleDisconnect = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  await googleCalendarService.disconnect(tenantId, actorId);
  sendSuccessResponse({ res, data: { ok: true }, message: "Google Calendar disconnected" });
};

// PUBLIC OAuth redirect target (no JWT, trust comes from the signed state).
// Always redirects the browser back to the SPA calendar page with a status flag
// rather than returning JSON, since a human is looking at it.
export const googleCallback = async (req: Request, res: Response) => {
  const base = `${config.CRM_APP_URL}/calendar`;
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  const oauthError = typeof req.query.error === "string" ? req.query.error : "";

  if (oauthError || !code || !state) {
    return res.redirect(`${base}?calendar=error`);
  }
  try {
    await googleCalendarService.handleCallback(code, state);
    return res.redirect(`${base}?calendar=connected`);
  } catch (err) {
    logger.warn(`Google Calendar callback failed: ${err}`);
    return res.redirect(`${base}?calendar=error`);
  }
};

export const listMeetings = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const owner = req.query.mine ? actorId : (req.query.owner as string | undefined);
  sendSuccessResponse({ res, data: await calendarService.meetings(tenantId, { owner }) });
};

export const scheduleMeeting = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const meeting = await calendarService.schedule(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: meeting,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Meeting scheduled",
  });
};

export const resyncMeeting = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const meeting = await calendarService.resync(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data: meeting, message: "Meeting synced to Google Calendar" });
};

export const cancelMeeting = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const meeting = await calendarService.cancel(tenantId, actorId, String(req.params.id));
  sendSuccessResponse({ res, data: meeting, message: "Meeting cancelled" });
};

export const deleteMeeting = async (req: Request, res: Response) => {
  const { tenantId, actorId, actorRole } = ctx(req);
  sendSuccessResponse({
    res,
    data: await calendarService.deleteMeeting(tenantId, actorId, actorRole, String(req.params.id)),
    message: "Meeting deleted",
  });
};

export const getWorkingHours = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await calendarService.getWorkingHours(tenantId) });
};

export const updateWorkingHours = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await calendarService.setWorkingHours(tenantId, actorId, req.body ?? {}),
    message: "Working hours saved",
  });
};

export const listReminders = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await calendarService.reminders(tenantId) });
};

export const listBookingLinks = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await calendarService.bookingLinks(tenantId) });
};

export const createBookingLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const link = await calendarService.createBookingLink(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: link,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Booking link created",
  });
};

// ---- Single per-agent booking link ("my link") ----

export const getMyBookingLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({ res, data: await calendarService.getMyBookingLink(tenantId, actorId) });
};

export const createMyBookingLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const link = await calendarService.createMyBookingLink(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: link,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Booking link ready",
  });
};

export const updateMyBookingLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const link = await calendarService.updateMyBookingLink(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({ res, data: link, message: "Booking link updated" });
};

export const shareMyBookingLink = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await calendarService.shareMyBookingLink(tenantId, actorId, req.body ?? {});
  sendSuccessResponse({
    res,
    data: result,
    message: `Booking link sent to ${result.sent} of ${result.total}`,
  });
};

// ---- PUBLIC booking page (no auth) ----

export const publicBookingInfo = async (req: Request, res: Response) => {
  const data = await calendarService.publicBookingInfo(
    String(req.params.tenantSlug),
    String(req.params.linkSlug)
  );
  sendSuccessResponse({ res, data });
};

export const publicBook = async (req: Request, res: Response) => {
  const data = await calendarService.publicBook(
    String(req.params.tenantSlug),
    String(req.params.linkSlug),
    req.body ?? {}
  );
  sendSuccessResponse({
    res,
    data,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Meeting booked",
  });
};

export const bookSlot = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  const result = await calendarService.book(
    tenantId,
    actorId,
    String(req.params.slug),
    req.body ?? {}
  );
  sendSuccessResponse({
    res,
    data: result,
    statusCode: HttpSuccessStatus.CREATED,
    message: "Slot booked",
  });
};
