import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as columnService from "./column.service.js";
import {
  createColumnSchema,
  listColumnsQuerySchema,
  reorderColumnsSchema,
  updateColumnSchema,
} from "./column.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createColumnSchema, req.body);
    const result = await columnService.createColumn(req.user.id, body);
    return successResponse(res, result, "Column created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listColumnsQuerySchema, req.query);
    const result = await columnService.listColumns(req.user.id, query.boardId);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateColumnSchema, req.body);
    const result = await columnService.updateColumn(
      req.user.id,
      param(req, "columnId"),
      body,
    );
    return successResponse(res, result, "Column updated");
  } catch (error) {
    next(error);
  }
}

export async function reorder(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(reorderColumnsSchema, req.body);
    const result = await columnService.reorderColumns(req.user.id, body);
    return successResponse(res, result, "Columns reordered");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await columnService.deleteColumn(
      req.user.id,
      param(req, "columnId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}
