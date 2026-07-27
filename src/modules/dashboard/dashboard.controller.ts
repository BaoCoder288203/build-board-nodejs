import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as dashboardService from "./dashboard.service.js";
import {
  dashboardWorkspaceQuerySchema,
  myTasksQuerySchema,
  upcomingQuerySchema,
} from "./dashboard.schema.js";

export async function summary(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(dashboardWorkspaceQuerySchema, req.query);
    const result = await dashboardService.getSummary(
      req.user.id,
      query.workspaceId,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function myTasks(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(myTasksQuerySchema, req.query);
    const result = await dashboardService.listMyTasks(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function upcoming(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(upcomingQuerySchema, req.query);
    const result = await dashboardService.listUpcoming(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
