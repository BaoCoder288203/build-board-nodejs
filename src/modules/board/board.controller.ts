import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { prisma } from "../../database/prisma.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace } from "../../realtime/socket.js";
import * as boardService from "./board.service.js";
import {
  createBoardSchema,
  listBoardsQuerySchema,
  updateBoardSchema,
} from "./board.schema.js";

async function resolveBoardScope(boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    select: { id: true, projectId: true, project: { select: { workspaceId: true } } },
  });
  if (!board) return null;
  return {
    boardId: board.id,
    projectId: board.projectId,
    workspaceId: board.project.workspaceId,
  };
}

function emitBoardChanged(
  scope: { boardId: string; workspaceId: string } | null,
  reason: "board_updated" | "board_archived" | "board_restored" | "board_deleted",
  actorId: string,
) {
  if (!scope) return;
  const rt = getRealtimeNamespace();
  if (!rt) return;
  rt.to(`board:${scope.boardId}`).emit(SERVER_EVENT.BOARD_CHANGED, {
    boardId: scope.boardId,
    workspaceId: scope.workspaceId,
    reason,
    actorId,
    occurredAt: new Date().toISOString(),
  });
}

function emitWorkspaceChanged(
  payload: {
    workspaceId: string;
    reason:
      | "board_created"
      | "board_updated"
      | "board_archived"
      | "board_restored"
      | "board_deleted";
    actorId: string;
    projectId?: string;
    boardId?: string;
  },
) {
  const rt = getRealtimeNamespace();
  if (!rt) return;
  rt.to(`workspace:${payload.workspaceId}`).emit(SERVER_EVENT.WORKSPACE_CHANGED, {
    ...payload,
    occurredAt: new Date().toISOString(),
  });
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createBoardSchema, req.body);
    const result = await boardService.createBoard(req.user.id, body);
    const project = await prisma.project.findFirst({
      where: { id: body.projectId, deletedAt: null },
      select: { workspaceId: true },
    });
    if (project) {
      emitWorkspaceChanged({
        workspaceId: project.workspaceId,
        reason: "board_created",
        actorId: req.user.id,
        projectId: body.projectId,
        boardId: result.id,
      });
    }
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
    const scope = await resolveBoardScope(param(req, "boardId"));
    const body = parseOrThrow(updateBoardSchema, req.body);
    const result = await boardService.updateBoard(
      req.user.id,
      param(req, "boardId"),
      body,
    );
    emitBoardChanged(scope, "board_updated", req.user.id);
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "board_updated",
        actorId: req.user.id,
        projectId: scope.projectId,
        boardId: scope.boardId,
      });
    }
    return successResponse(res, result, "Board updated");
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveBoardScope(param(req, "boardId"));
    const result = await boardService.archiveBoard(
      req.user.id,
      param(req, "boardId"),
    );
    emitBoardChanged(scope, "board_archived", req.user.id);
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "board_archived",
        actorId: req.user.id,
        projectId: scope.projectId,
        boardId: scope.boardId,
      });
    }
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveBoardScope(param(req, "boardId"));
    const result = await boardService.restoreBoard(
      req.user.id,
      param(req, "boardId"),
    );
    emitBoardChanged(scope, "board_restored", req.user.id);
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "board_restored",
        actorId: req.user.id,
        projectId: scope.projectId,
        boardId: scope.boardId,
      });
    }
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveBoardScope(param(req, "boardId"));
    const result = await boardService.deleteBoard(
      req.user.id,
      param(req, "boardId"),
    );
    emitBoardChanged(scope, "board_deleted", req.user.id);
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "board_deleted",
        actorId: req.user.id,
        projectId: scope.projectId,
        boardId: scope.boardId,
      });
    }
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}
