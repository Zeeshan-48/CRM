import { NextFunction, Request, Response } from "express";

export const asyncHandler = (
  fnc: (req: Request, res: Response, next: NextFunction) => void | Promise<void>
) => {
  return (req: Request, res: Response, next: NextFunction): Promise<void> => {
    return Promise.resolve(fnc(req, res, next)).catch((err) => next(err));
  };
};
