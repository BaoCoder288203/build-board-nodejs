import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as searchService from "./search.service.js";
import {
  globalSearchQuerySchema,
  searchTasksQuerySchema,
} from "./search.schema.js";

export async function global(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(globalSearchQuerySchema, req.query);
    const result = await searchService.globalSearch(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function tasks(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(searchTasksQuerySchema, req.query);
    const result = await searchService.searchTasks(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
