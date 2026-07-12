import type { Response } from "express";

export function successResponse<T>(
  res: Response,
  data: T,
  message = "Success",
  statusCode = 200,
) {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
    timestamp: new Date().toISOString(),
  });
}

export function errorResponse(
  res: Response,
  message: string,
  statusCode = 500,
  errors?: unknown,
) {
  return res.status(statusCode).json({
    success: false,
    message,
    errors: errors ?? null,
    timestamp: new Date().toISOString(),
  });
}
