import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { prisma } from "../../database/prisma.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace } from "../../realtime/socket.js";
import * as columnService from "./column.service.js";
import {
  copyColumnSchema,
  createColumnSchema,
  listColumnsQuerySchema,
  moveColumnSchema,
  moveColumnTasksSchema,
  reorderColumnsSchema,
  sortColumnSchema,
  updateColumnSchema,
} from "./column.schema.js";

async function resolveBoardScope(boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    select: { id: true, project: { select: { workspaceId: true } } },
  });
  if (!board) return null;
  return { boardId: board.id, workspaceId: board.project.workspaceId };
}

async function resolveColumnScope(columnId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null },
    select: {
      boardId: true,
      board: { select: { project: { select: { workspaceId: true } } } },
    },
  });
  if (!column) return null;
  return { boardId: column.boardId, workspaceId: column.board.project.workspaceId };
}

function emitBoardChanged(
  scope: { boardId: string; workspaceId: string } | null,
  reason:
    | "column_created"
    | "column_updated"
    | "column_reordered"
    | "column_deleted"
    | "column_copied"
    | "column_moved"
    | "column_tasks_moved"
    | "column_sorted"
    | "column_archived"
    | "column_restored",
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

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createColumnSchema, req.body);
    const result = await columnService.createColumn(req.user.id, body);
    const scope = await resolveBoardScope(body.boardId);
    emitBoardChanged(scope, "column_created", req.user.id);
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
    const scope = await resolveColumnScope(param(req, "columnId"));
    const body = parseOrThrow(updateColumnSchema, req.body);
    const result = await columnService.updateColumn(
      req.user.id,
      param(req, "columnId"),
      body,
    );
    emitBoardChanged(scope, "column_updated", req.user.id);
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
    const scope = await resolveBoardScope(body.boardId);
    emitBoardChanged(scope, "column_reordered", req.user.id);
    return successResponse(res, result, "Columns reordered");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveColumnScope(param(req, "columnId"));
    const result = await columnService.deleteColumn(
      req.user.id,
      param(req, "columnId"),
    );
    emitBoardChanged(scope, "column_deleted", req.user.id);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function copy(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveColumnScope(param(req, "columnId"));
    const body = parseOrThrow(copyColumnSchema, req.body);
    const result = await columnService.copyColumn(
      req.user.id,
      param(req, "columnId"),
      body,
    );
    emitBoardChanged(scope, "column_copied", req.user.id);
    return successResponse(res, result, "Column copied", 201);
  } catch (error) {
    next(error);
  }
}

export async function move(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const sourceScope = await resolveColumnScope(param(req, "columnId"));
    const body = parseOrThrow(moveColumnSchema, req.body);
    const result = await columnService.moveColumn(
      req.user.id,
      param(req, "columnId"),
      body,
    );
    const destinationScope = await resolveBoardScope(body.boardId);
    emitBoardChanged(sourceScope, "column_moved", req.user.id);
    if (!sourceScope || sourceScope.boardId !== destinationScope?.boardId) {
      emitBoardChanged(destinationScope, "column_moved", req.user.id);
    }
    return successResponse(res, result, "Column moved");
  } catch (error) {
    next(error);
  }
}

export async function moveTasks(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const sourceScope = await resolveColumnScope(param(req, "columnId"));
    const body = parseOrThrow(moveColumnTasksSchema, req.body);
    const result = await columnService.moveAllTasksInColumn(
      req.user.id,
      param(req, "columnId"),
      body.destinationColumnId,
    );
    const destinationScope = await resolveColumnScope(body.destinationColumnId);
    emitBoardChanged(sourceScope, "column_tasks_moved", req.user.id);
    if (!sourceScope || sourceScope.boardId !== destinationScope?.boardId) {
      emitBoardChanged(destinationScope, "column_tasks_moved", req.user.id);
    }
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function sort(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveColumnScope(param(req, "columnId"));
    const body = parseOrThrow(sortColumnSchema, req.body);
    const result = await columnService.sortColumnTasks(
      req.user.id,
      param(req, "columnId"),
      body.sortBy,
    );
    emitBoardChanged(scope, "column_sorted", req.user.id);
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveColumnScope(param(req, "columnId"));
    const result = await columnService.archiveColumn(
      req.user.id,
      param(req, "columnId"),
    );
    emitBoardChanged(scope, "column_archived", req.user.id);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function restore(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveColumnScope(param(req, "columnId"));
    const result = await columnService.restoreColumn(
      req.user.id,
      param(req, "columnId"),
    );
    emitBoardChanged(scope, "column_restored", req.user.id);
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}
