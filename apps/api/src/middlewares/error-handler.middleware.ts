import { NextFunction, Request, Response } from "express";
import config from "../config";
import { CustomError } from "../errors";
import logger from "../utils/logger";
import { rayId } from "../utils/rayid";

export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (res.headersSent || !res.writable) {
    logger.warn("Error handler: response already sent or not writable");
    return;
  }

  const errorId = rayId();

  if (err instanceof CustomError) {
    const serialized = err.serializeErrors();
    const message = `route: ${req.path}, errorMsg: ${serialized.message}, rayId: ${errorId}`;
    logger.error(message);
    res.status(err.statusCode).json({
      error: { ...serialized },
      statusCode: err.statusCode,
      message,
      success: false,
    });
    return;
  }

  if (err instanceof Error) {
    const message = `route: ${req.path}, errorMsg: ${err.message}, rayId: ${errorId}`;
    logger.error(`${message}\n${err.stack ?? ""}`);
    res.status(500).json({
      error: { message: config.isProduction ? "Internal Server Error" : err.message },
      statusCode: 500,
      // The exception text stays in the log in production; callers get the ray id.
      message: config.isProduction
        ? `route: ${req.path}, errorMsg: INTERNAL SERVER ERROR, rayId: ${errorId}`
        : message,
      success: false,
    });
    return;
  }

  const message = `route: ${req.path}, errorMsg: INTERNAL SERVER ERROR, rayId: ${errorId}`;
  logger.error(message);
  res.status(500).json({
    error: { message: "Internal Server Error" },
    statusCode: 500,
    message,
    success: false,
  });
};
