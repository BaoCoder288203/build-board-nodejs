import type { Request } from "express";
import { AppError } from "../common/app-error.js";

/** Express 5 params may be `string | string[]` — normalize to a single string. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || typeof raw !== "string") {
    throw new AppError(`${name} is required`, 400, "BAD_REQUEST");
  }
  return raw;
}
