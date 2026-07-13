import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { prisma } from "../../database/prisma.js";
import * as workspaceService from "./workspace.service.js";
import {
  changeMemberRoleSchema,
  createWorkspaceSchema,
  invitationTokenSchema,
  inviteMemberSchema,
  listQuerySchema,
  transferOwnerSchema,
  updateSettingsSchema,
  updateWorkspaceSchema,
} from "./workspace.schema.js";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createWorkspaceSchema, req.body);
    const result = await workspaceService.createWorkspace(req.user.id, body);
    return successResponse(res, result, "Workspace created", 201);
  } catch (error) {
    next(error);
  }
}

export async function listMine(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await workspaceService.listMyWorkspaces(
      req.user.id,
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
    const workspaceId = param(req, "workspaceId");
    const result = await workspaceService.getWorkspace(workspaceId);
    return successResponse(res, {
      ...result,
      myMembership: req.workspace
        ? {
            memberId: req.workspace.memberId,
            roleName: req.workspace.roleName,
            permissions: req.workspace.permissions,
            isOwner: req.workspace.isOwner,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateWorkspaceSchema, req.body);
    const result = await workspaceService.updateWorkspace(
      param(req, "workspaceId"),
      req.user.id,
      body,
    );
    return successResponse(res, result, "Workspace updated");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await workspaceService.deleteWorkspace(
      param(req, "workspaceId"),
      req.user.id,
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function listRoles(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await workspaceService.listRoles(param(req, "workspaceId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function listMembers(req: Request, res: Response, next: NextFunction) {
  try {
    const query = parseOrThrow(listQuerySchema, req.query);
    const result = await workspaceService.listMembers(
      param(req, "workspaceId"),
      query.page,
      query.limit,
      query.search,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function invite(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(inviteMemberSchema, req.body);
    const result = await workspaceService.inviteMember(
      param(req, "workspaceId"),
      req.user.id,
      body,
    );
    return successResponse(res, result, result.message, 201);
  } catch (error) {
    next(error);
  }
}

export async function acceptInvite(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(invitationTokenSchema, req.body);
    const result = await workspaceService.acceptInvitation(
      req.user.id,
      req.user.email,
      body.token,
    );
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function rejectInvite(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(invitationTokenSchema, req.body);
    const result = await workspaceService.rejectInvitation(
      req.user.email,
      body.token,
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function changeRole(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user || !req.workspace) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const body = parseOrThrow(changeMemberRoleSchema, req.body);
    const workspaceId = param(req, "workspaceId");
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const result = await workspaceService.changeMemberRole(
      workspaceId,
      req.user.id,
      param(req, "memberId"),
      body.roleId,
      workspace.ownerId,
    );
    return successResponse(res, result, "Member role updated");
  } catch (error) {
    next(error);
  }
}

export async function removeMember(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const workspaceId = param(req, "workspaceId");
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const result = await workspaceService.removeMember(
      workspaceId,
      req.user.id,
      param(req, "memberId"),
      workspace.ownerId,
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function leave(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const workspaceId = param(req, "workspaceId");
    const workspace = await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    const result = await workspaceService.leaveWorkspace(
      workspaceId,
      req.user.id,
      workspace.ownerId,
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function transferOwner(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(transferOwnerSchema, req.body);
    const result = await workspaceService.transferOwnership(
      param(req, "workspaceId"),
      req.user.id,
      body.memberId,
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function getSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await workspaceService.getSettings(param(req, "workspaceId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateSettingsSchema, req.body);
    const result = await workspaceService.updateSettings(
      param(req, "workspaceId"),
      req.user.id,
      body,
    );
    return successResponse(res, result, "Settings updated");
  } catch (error) {
    next(error);
  }
}

export async function getStorage(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await workspaceService.getStorage(param(req, "workspaceId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}
