import { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodType } from "zod";
import { BadRequestError } from "../errors";

/**
 * Request-body validation gate. Checks `req.body` against a zod schema and, on
 * failure, rejects with a 400 + the first issue's path/message BEFORE the
 * controller runs. It deliberately does NOT reassign `req.body`: the schemas
 * mirror existing behavior (unknown keys tolerated, service-side coercion and
 * defaults untouched), so validation only ever *adds* an early clear rejection, * it never changes the payload a controller already handles today.
 */
export const validateBody = (schema: ZodType): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.join(".");
      const message = issue
        ? path
          ? `${path}: ${issue.message}`
          : issue.message
        : "Invalid request body";
      next(new BadRequestError(message));
      return;
    }
    next();
  };
};
