import { Response } from "express";
import logger from "./logger";

export enum HttpSuccessStatus {
  OK = 200,
  CREATED = 201,
  ACCEPTED = 202,
  NO_CONTENT = 204,
}

export interface IResponseFormat<T = unknown> {
  data: T;
  statusCode: number;
  message: string;
  success: boolean;
}

const defaultMessages: Record<HttpSuccessStatus, string> = {
  [HttpSuccessStatus.OK]: "Request successful",
  [HttpSuccessStatus.CREATED]: "Resource created successfully",
  [HttpSuccessStatus.ACCEPTED]: "Request accepted",
  [HttpSuccessStatus.NO_CONTENT]: "Request processed successfully",
};

export const sendSuccessResponse = <T>({
  res,
  data,
  statusCode = HttpSuccessStatus.OK,
  message,
}: {
  res: Response;
  data: T;
  statusCode?: HttpSuccessStatus;
  message?: string;
}): void => {
  if (res.headersSent || !res.writable) {
    logger.warn("Attempted to send response after headers were already sent");
    return;
  }
  const response: IResponseFormat<T> = {
    data,
    statusCode,
    message: message || defaultMessages[statusCode],
    success: true,
  };
  res.status(statusCode).json(response);
};
