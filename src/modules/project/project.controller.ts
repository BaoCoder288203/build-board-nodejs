import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { prisma } from "../../database/prisma.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace } from "../../realtime/socket.js";
import * as projectService from "./project.service.js";
import {
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
} from "./project.schema.js";

async function resolveProjectScope(projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, workspaceId: true },
  });
  if (!project) return null;
  return { projectId: project.id, workspaceId: project.workspaceId };
}

function emitWorkspaceChanged(
  payload: {
    workspaceId: string;
    reason:
      | "project_created"
      | "project_updated"
      | "project_archived"
      | "project_restored"
      | "project_deleted";
    actorId: string;
    projectId?: string;
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
    const body = parseOrThrow(createProjectSchema, req.body);
    const result = await projectService.createProject(req.user.id, body);
    emitWorkspaceChanged({
      workspaceId: body.workspaceId,
      reason: "project_created",
      actorId: req.user.id,
      projectId: result.id,
    });
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
    const scope = await resolveProjectScope(param(req, "projectId"));
    const body = parseOrThrow(updateProjectSchema, req.body);
    const result = await projectService.updateProject(
      req.user.id,
      param(req, "projectId"),
      body,
    );
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "project_updated",
        actorId: req.user.id,
        projectId: scope.projectId,
      });
    }
    return successResponse(res, result, "Project updated");
  } catch (error) {
    next(error);
  }
}

export async function archive(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveProjectScope(param(req, "projectId"));
    const result = await projectService.archiveProject(
      req.user.id,
      param(req, "projectId"),
    );
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "project_archived",
        actorId: req.user.id,
        projectId: scope.projectId,
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
    const scope = await resolveProjectScope(param(req, "projectId"));
    const result = await projectService.restoreProject(
      req.user.id,
      param(req, "projectId"),
    );
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "project_restored",
        actorId: req.user.id,
        projectId: scope.projectId,
      });
    }
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const scope = await resolveProjectScope(param(req, "projectId"));
    const result = await projectService.deleteProject(
      req.user.id,
      param(req, "projectId"),
    );
    if (scope) {
      emitWorkspaceChanged({
        workspaceId: scope.workspaceId,
        reason: "project_deleted",
        actorId: req.user.id,
        projectId: scope.projectId,
      });
    }
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}
