import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/app-error.js";
import { errorResponse } from "../common/response.js";
import {
  formatZodError,
  normalizeValidationErrors,
} from "../common/validation.js";

export function notFoundHandler(_req: Request, res: Response) {
  return errorResponse(res, "Route not found", 404);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    const formatted = formatZodError(err);
    return res.status(400).json({
      success: false,
      message: formatted.message,
      code: "VALIDATION_ERROR",
      errors: formatted.errors,
      timestamp: new Date().toISOString(),
      path: req.path,
    });
  }

  if (err instanceof AppError) {
    let message = err.message;
    let errors = err.errors ?? null;

    if (err.code === "VALIDATION_ERROR") {
      const normalized = normalizeValidationErrors(err.errors);
      if (normalized.errors) {
        errors = normalized.errors;
      }
      // Prefer field copy over generic "Validation failed"
      if (
        normalized.message &&
        (!message || message === "Validation failed")
      ) {
        message = normalized.message;
      }
    }

    return res.status(err.statusCode).json({
      success: false,
      message,
      code: err.code,
      errors,
      timestamp: new Date().toISOString(),
      path: req.path,
    });
  }

  console.error("[error]", {
    path: req.path,
    message: err instanceof Error ? err.message : err,
    stack:
      process.env.NODE_ENV === "development" && err instanceof Error
        ? err.stack
        : undefined,
  });

  return errorResponse(
    res,
    process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err instanceof Error
        ? err.message
        : "Internal server error",
    500,
  );
}
