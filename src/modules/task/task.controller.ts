import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace } from "../../realtime/socket.js";
import * as taskService from "./task.service.js";
import {
  assignTaskSchema,
  calendarTasksQuerySchema,
  createProjectLabelSchema,
  createTaskSchema,
  duplicateTaskSchema,
  labelTaskSchema,
  listTasksQuerySchema,
  moveTaskSchema,
  pinTaskSchema,
  updateTaskSchema,
} from "./task.schema.js";

function emitTaskUpdated(
  task: {
    id: string;
    taskId?: string;
    boardId: string;
    workspaceId: string;
    columnId: string;
    position: number;
    [key: string]: unknown;
  },
  userId: string,
) {
  const rt = getRealtimeNamespace();
  if (!rt) return;
  rt.to(`board:${task.boardId}`).emit(SERVER_EVENT.TASK_UPDATED, {
    task,
    updatedBy: userId,
    occurredAt: new Date().toISOString(),
  });
  rt.to(`workspace:${task.workspaceId}`).emit(SERVER_EVENT.TASK_UPDATED, {
    task,
    updatedBy: userId,
    occurredAt: new Date().toISOString(),
  });
}

function emitTaskCreated(
  task: {
    id: string;
    taskId?: string;
    boardId: string;
    workspaceId: string;
    columnId: string;
    position: number;
    [key: string]: unknown;
  },
  userId: string,
) {
  const rt = getRealtimeNamespace();
  if (!rt) return;
  rt.to(`board:${task.boardId}`).emit(SERVER_EVENT.TASK_CREATED, {
    task,
    updatedBy: userId,
    occurredAt: new Date().toISOString(),
  });
  rt.to(`workspace:${task.workspaceId}`).emit(SERVER_EVENT.TASK_CREATED, {
    task,
    updatedBy: userId,
    occurredAt: new Date().toISOString(),
  });
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createTaskSchema, req.body);
    const result = await taskService.createTask(req.user.id, body);
    emitTaskCreated(result, req.user.id);
    return successResponse(res, result, "Task created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listTasksQuerySchema, req.query);
    const result = await taskService.listTasks(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function calendar(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(calendarTasksQuerySchema, req.query);
    const result = await taskService.listCalendarTasks(req.user.id, query);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.getTask(req.user.id, param(req, "taskId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateTaskSchema, req.body);
    const result = await taskService.updateTask(
      req.user.id,
      param(req, "taskId"),
      body,
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Task updated");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.deleteTask(
      req.user.id,
      param(req, "taskId"),
    );
    const rt = getRealtimeNamespace();
    if (rt) {
      rt.to(`board:${result.boardId}`).emit(SERVER_EVENT.TASK_DELETED, {
        taskId: result.taskId,
        boardId: result.boardId,
        workspaceId: result.workspaceId,
        deletedBy: req.user.id,
        occurredAt: new Date().toISOString(),
      });
      rt.to(`workspace:${result.workspaceId}`).emit(SERVER_EVENT.TASK_DELETED, {
        taskId: result.taskId,
        boardId: result.boardId,
        workspaceId: result.workspaceId,
        deletedBy: req.user.id,
        occurredAt: new Date().toISOString(),
      });
    }
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function move(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(moveTaskSchema, req.body);
    const result = await taskService.moveTask(
      req.user.id,
      param(req, "taskId"),
      body,
    );

    const rt = getRealtimeNamespace();
    if (rt) {
      rt.to(`board:${result.boardId}`).emit(SERVER_EVENT.TASK_MOVED, {
        taskId: result.id,
        boardId: result.boardId,
        workspaceId: result.workspaceId,
        sourceColumnId: body.sourceColumnId ?? result.columnId,
        destinationColumnId: result.columnId,
        newPosition: result.position,
        movedBy: req.user.id,
        occurredAt: new Date().toISOString(),
      });
      rt.to(`workspace:${result.workspaceId}`).emit(SERVER_EVENT.TASK_MOVED, {
        taskId: result.id,
        boardId: result.boardId,
        workspaceId: result.workspaceId,
        sourceColumnId: body.sourceColumnId ?? result.columnId,
        destinationColumnId: result.columnId,
        newPosition: result.position,
        movedBy: req.user.id,
        occurredAt: new Date().toISOString(),
      });
    }

    return successResponse(res, result, "Task moved");
  } catch (error) {
    next(error);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(assignTaskSchema, req.body);
    const result = await taskService.assignTask(
      req.user.id,
      param(req, "taskId"),
      body.userId,
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Assignee added");
  } catch (error) {
    next(error);
  }
}

export async function unassign(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(assignTaskSchema, req.body);
    const result = await taskService.unassignTask(
      req.user.id,
      param(req, "taskId"),
      body.userId,
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Assignee removed");
  } catch (error) {
    next(error);
  }
}

export async function watch(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.watchTask(req.user.id, param(req, "taskId"));
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Watching task");
  } catch (error) {
    next(error);
  }
}

export async function unwatch(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.unwatchTask(
      req.user.id,
      param(req, "taskId"),
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Stopped watching task");
  } catch (error) {
    next(error);
  }
}

export async function pin(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(pinTaskSchema, req.body);
    const result = await taskService.pinTask(
      req.user.id,
      param(req, "taskId"),
      body.pinned,
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, body.pinned ? "Task pinned" : "Task unpinned");
  } catch (error) {
    next(error);
  }
}

export async function duplicate(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(duplicateTaskSchema, req.body ?? {});
    const result = await taskService.duplicateTask(
      req.user.id,
      param(req, "taskId"),
      body.destinationColumnId,
    );
    return successResponse(res, result, "Task duplicated", 201);
  } catch (error) {
    next(error);
  }
}

export async function addLabel(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(labelTaskSchema, req.body);
    const result = await taskService.addTaskLabel(
      req.user.id,
      param(req, "taskId"),
      body.labelId,
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Label added");
  } catch (error) {
    next(error);
  }
}

export async function removeLabel(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.removeTaskLabel(
      req.user.id,
      param(req, "taskId"),
      param(req, "labelId"),
    );
    emitTaskUpdated(result, req.user.id);
    return successResponse(res, result, "Label removed");
  } catch (error) {
    next(error);
  }
}

export async function listLabels(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const projectId = String(req.query.projectId ?? "");
    if (!projectId) {
      throw new AppError("projectId is required", 400, "VALIDATION_ERROR");
    }
    const result = await taskService.listProjectLabels(req.user.id, projectId);
    return successResponse(res, { items: result });
  } catch (error) {
    next(error);
  }
}

export async function createLabel(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createProjectLabelSchema, req.body);
    const result = await taskService.createProjectLabel(req.user.id, body);
    return successResponse(res, result, "Label created", 201);
  } catch (error) {
    next(error);
  }
}

export async function deleteLabelDef(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await taskService.deleteProjectLabel(
      req.user.id,
      param(req, "labelId"),
    );
    return successResponse(res, result, "Label deleted");
  } catch (error) {
    next(error);
  }
}
