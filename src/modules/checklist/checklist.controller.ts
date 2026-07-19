import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as checklistService from "./checklist.service.js";
import {
  completeChecklistItemSchema,
  createChecklistItemSchema,
  createChecklistSchema,
  listChecklistsQuerySchema,
  reorderChecklistItemsSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from "./checklist.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createChecklistSchema, req.body);
    const result = await checklistService.createChecklist(req.user.id, body);
    return successResponse(res, result, "Checklist created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listChecklistsQuerySchema, req.query);
    const result = await checklistService.listChecklists(
      req.user.id,
      query.taskId,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateChecklistSchema, req.body);
    const result = await checklistService.updateChecklist(
      req.user.id,
      param(req, "checklistId"),
      body,
    );
    return successResponse(res, result, "Checklist updated");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await checklistService.deleteChecklist(
      req.user.id,
      param(req, "checklistId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function createItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createChecklistItemSchema, req.body);
    const result = await checklistService.createChecklistItem(
      req.user.id,
      param(req, "checklistId"),
      body,
    );
    return successResponse(res, result, "Checklist item created", 201);
  } catch (error) {
    next(error);
  }
}

export async function updateItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateChecklistItemSchema, req.body);
    const result = await checklistService.updateChecklistItem(
      req.user.id,
      param(req, "itemId"),
      body,
    );
    return successResponse(res, result, "Checklist item updated");
  } catch (error) {
    next(error);
  }
}

export async function completeItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(completeChecklistItemSchema, req.body);
    const result = await checklistService.completeChecklistItem(
      req.user.id,
      param(req, "itemId"),
      body.completed,
    );
    return successResponse(
      res,
      result,
      body.completed ? "Checklist item completed" : "Checklist item reopened",
    );
  } catch (error) {
    next(error);
  }
}

export async function removeItem(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await checklistService.deleteChecklistItem(
      req.user.id,
      param(req, "itemId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function reorderItems(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(reorderChecklistItemsSchema, req.body);
    const result = await checklistService.reorderChecklistItems(
      req.user.id,
      param(req, "checklistId"),
      body,
    );
    return successResponse(res, result, "Checklist items reordered");
  } catch (error) {
    next(error);
  }
}

export async function progress(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await checklistService.getChecklistProgress(
      req.user.id,
      param(req, "checklistId"),
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
