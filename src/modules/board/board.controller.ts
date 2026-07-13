import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as boardService from "./board.service.js";
import {
  createBoardSchema,
  listBoardsQuerySchema,
  updateBoardSchema,
} from "./board.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createBoardSchema, req.body);
    const result = await boardService.createBoard(req.user.id, body);
    return successResponse(res, result, "Board created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listBoardsQuerySchema, req.query);
    const result = await boardService.listBoards(
      req.user.id,
      query.projectId,
      query.page,
      query.limit,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await boardService.getBoard(req.user.id, param(req, "boardId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateBoardSchema, req.body);
    const result = await boardService.updateBoard(
      req.user.id,
      param(req, "boardId"),
      body,
    );
    return successResponse(res, result, "Board updated");
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await boardService.archiveBoard(
      req.user.id,
      param(req, "boardId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await boardService.deleteBoard(
      req.user.id,
      param(req, "boardId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}
