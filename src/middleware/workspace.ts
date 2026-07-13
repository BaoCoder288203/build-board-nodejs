import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/app-error.js";
import { param } from "../common/params.js";
import { prisma } from "../database/prisma.js";

export type WorkspaceContext = {
  workspaceId: string;
  memberId: string;
  roleId: string;
  roleName: string;
  permissions: string[];
  isOwner: boolean;
};

declare global {
  namespace Express {
    interface Request {
      workspace?: WorkspaceContext;
    }
  }
}

export async function requireWorkspaceMember(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const workspaceId = param(req, "workspaceId");

    const workspace = await prisma.workspace.findFirst({
      where: { id: workspaceId, deletedAt: null },
    });
    if (!workspace) {
      throw new AppError("Workspace not found", 404, "WORKSPACE_NOT_FOUND");
    }

    const member = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: {
          workspaceId,
          userId: req.user.id,
        },
      },
      include: {
        role: {
          include: { permissions: true },
        },
      },
    });

    if (!member) {
      throw new AppError(
        "You are not a member of this workspace",
        403,
        "NOT_WORKSPACE_MEMBER",
      );
    }

    req.workspace = {
      workspaceId,
      memberId: member.id,
      roleId: member.roleId,
      roleName: member.role.name,
      permissions: member.role.permissions.map((p) => p.permissionKey),
      isOwner: workspace.ownerId === req.user.id,
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(...keys: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.workspace) {
        throw new AppError(
          "You are not a member of this workspace",
          403,
          "NOT_WORKSPACE_MEMBER",
        );
      }

      const allowed = keys.some((key) =>
        req.workspace!.permissions.includes(key),
      );
      if (!allowed && !req.workspace.isOwner) {
        throw new AppError(
          "You do not have permission to perform this action",
          403,
          "FORBIDDEN",
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  try {
    if (!req.workspace?.isOwner) {
      throw new AppError(
        "Only the workspace owner can perform this action",
        403,
        "OWNER_REQUIRED",
      );
    }
    next();
  } catch (error) {
    next(error);
  }
}
