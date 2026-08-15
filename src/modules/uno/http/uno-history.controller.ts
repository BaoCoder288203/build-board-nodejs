import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../common/app-error.js";
import { param } from "../../../common/params.js";
import { successResponse } from "../../../common/response.js";
import * as sessionService from "../session/game-session.service.js";

export async function results(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHENTICATED");
    const data = await sessionService.listHistory(req.user.id, param(req, "roomId"));
    return successResponse(res, data);
  } catch (error) {
    next(error);
  }
}
