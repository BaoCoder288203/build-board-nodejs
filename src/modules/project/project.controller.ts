import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as projectService from "./project.service.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from "./project.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createProjectSchema, req.body);
    const result = await projectService.createProject(req.user.id, body);
    return successResponse(res, result, "Project created", 201);
  } catch (error) {
    next(error);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listProjectsQuerySchema, req.query);
    const result = await projectService.listProjects(
      req.user.id,
      query.workspaceId,
      query.page,
      query.limit,
      query.search,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await projectService.getProject(
      req.user.id,
      param(req, "projectId"),
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateProjectSchema, req.body);
    const result = await projectService.updateProject(
      req.user.id,
      param(req, "projectId"),
      body,
    );
    return successResponse(res, result, "Project updated");
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await projectService.archiveProject(
      req.user.id,
      param(req, "projectId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await projectService.deleteProject(
      req.user.id,
      param(req, "projectId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}
