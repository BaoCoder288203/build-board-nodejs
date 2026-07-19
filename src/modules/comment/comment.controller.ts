import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as commentService from "./comment.service.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  replyCommentSchema,
  updateCommentSchema,
} from "./comment.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createCommentSchema, req.body);
    const result = await commentService.createComment(req.user.id, body);
    return successResponse(res, result, "Comment created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listCommentsQuerySchema, req.query);
    const result = await commentService.listComments(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateCommentSchema, req.body);
    const result = await commentService.updateComment(
      req.user.id,
      param(req, "commentId"),
      body,
    );
    return successResponse(res, result, "Comment updated");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await commentService.deleteComment(
      req.user.id,
      param(req, "commentId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function reply(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(replyCommentSchema, req.body);
    const result = await commentService.replyToComment(
      req.user.id,
      param(req, "commentId"),
      body,
    );
    return successResponse(res, result, "Reply created", 201);
  } catch (error) {
    next(error);
  }
}

export async function listReplies(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await commentService.listReplies(
      req.user.id,
      param(req, "commentId"),
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
