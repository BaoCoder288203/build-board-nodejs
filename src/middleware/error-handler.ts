import type { NextFunction, Request, Response } from "express";
import { errorResponse } from "../common/response.js";

export function notFoundHandler(_req: Request, res: Response) {
  return errorResponse(res, "Route not found", 404);
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  console.error("[error]", {
    path: req.path,
    message: err.message,
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });

  return errorResponse(
    res,
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
    500,
  );
}
