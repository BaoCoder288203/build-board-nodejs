import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as taskService from "./task.service.js";
import {
  assignTaskSchema,
  createTaskSchema,
  labelTaskSchema,
  listTasksQuerySchema,
  moveTaskSchema,
  updateTaskSchema,
} from "./task.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createTaskSchema, req.body);
    const result = await taskService.createTask(req.user.id, body);
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
    return successResponse(res, result, "Assignee removed");
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
