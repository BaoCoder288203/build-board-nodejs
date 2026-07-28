import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { prisma } from "../../database/prisma.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace } from "../../realtime/socket.js";
import * as commentService from "./comment.service.js";
import {
  createCommentSchema,
  listCommentsQuerySchema,
  reactionSchema,
  replyCommentSchema,
  updateCommentSchema,
} from "./comment.schema.js";

type CommentPublic = {
  id: string;
  taskId: string;
  parentCommentId?: string | null;
  [key: string]: unknown;
};

function emitCommentEvent(
  event:
    | typeof SERVER_EVENT.COMMENT_CREATED
    | typeof SERVER_EVENT.COMMENT_UPDATED
    | typeof SERVER_EVENT.COMMENT_REACTION,
  boardId: string,
  workspaceId: string,
  comment: CommentPublic,
  actorId: string,
) {
  const rt = getRealtimeNamespace();
  if (!rt || !boardId) return;
  const payload = {
    boardId,
    workspaceId,
    taskId: comment.taskId,
    comment,
    actorId,
    occurredAt: new Date().toISOString(),
  };
  rt.to(`board:${boardId}`).emit(event, payload);
  rt.to(`workspace:${workspaceId}`).emit(event, payload);
}

async function resolveBoardMeta(taskId: string) {
  return prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { boardId: true, workspaceId: true },
  });
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createCommentSchema, req.body);
    const result = await commentService.createComment(req.user.id, body);
    const meta = await resolveBoardMeta(result.taskId);
    if (meta) {
      emitCommentEvent(
        SERVER_EVENT.COMMENT_CREATED,
        meta.boardId,
        meta.workspaceId,
        result,
        req.user.id,
      );
    }
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
    const meta = await resolveBoardMeta(result.taskId);
    if (meta) {
      emitCommentEvent(
        SERVER_EVENT.COMMENT_UPDATED,
        meta.boardId,
        meta.workspaceId,
        result,
        req.user.id,
      );
    }
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
    const rt = getRealtimeNamespace();
    if (rt) {
      const payload = {
        boardId: result.boardId,
        workspaceId: result.workspaceId,
        taskId: result.taskId,
        commentId: result.commentId,
        parentCommentId: result.parentCommentId,
        actorId: req.user.id,
        occurredAt: new Date().toISOString(),
      };
      rt.to(`board:${result.boardId}`).emit(SERVER_EVENT.COMMENT_DELETED, payload);
      rt.to(`workspace:${result.workspaceId}`).emit(
        SERVER_EVENT.COMMENT_DELETED,
        payload,
      );
    }
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
    const meta = await resolveBoardMeta(result.taskId);
    if (meta) {
      emitCommentEvent(
        SERVER_EVENT.COMMENT_CREATED,
        meta.boardId,
        meta.workspaceId,
        result,
        req.user.id,
      );
    }
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

export async function addReaction(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(reactionSchema, req.body);
    const result = await commentService.toggleReaction(
      req.user.id,
      param(req, "commentId"),
      body.emoji,
    );
    const meta = await resolveBoardMeta(result.taskId);
    if (meta) {
      emitCommentEvent(
        SERVER_EVENT.COMMENT_REACTION,
        meta.boardId,
        meta.workspaceId,
        result,
        req.user.id,
      );
    }
    return successResponse(res, result, "Reaction updated");
  } catch (error) {
    next(error);
  }
}

export async function removeReaction(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const emoji = decodeURIComponent(param(req, "emoji"));
    const body = parseOrThrow(reactionSchema, { emoji });
    const result = await commentService.removeReaction(
      req.user.id,
      param(req, "commentId"),
      body.emoji,
    );
    const meta = await resolveBoardMeta(result.taskId);
    if (meta) {
      emitCommentEvent(
        SERVER_EVENT.COMMENT_REACTION,
        meta.boardId,
        meta.workspaceId,
        result,
        req.user.id,
      );
    }
    return successResponse(res, result, "Reaction removed");
  } catch (error) {
    next(error);
  }
}
