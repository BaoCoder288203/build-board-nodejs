import { AppError } from "../common/app-error.js";
import { prisma } from "../database/prisma.js";

export async function getWorkspaceMembership(userId: string, workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
  });
  if (!workspace) {
    throw new AppError("Workspace not found", 404, "WORKSPACE_NOT_FOUND");
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
    include: {
      role: { include: { permissions: true } },
    },
  });

  if (!member) {
    throw new AppError(
      "You are not a member of this workspace",
      403,
      "NOT_WORKSPACE_MEMBER",
    );
  }

  return {
    workspace,
    member,
    permissions: member.role.permissions.map((p) => p.permissionKey),
    isOwner: workspace.ownerId === userId,
    roleName: member.role.name,
  };
}

export function assertPermission(
  ctx: { permissions: string[]; isOwner: boolean },
  ...keys: string[]
) {
  if (ctx.isOwner) return;
  const ok = keys.some((k) => ctx.permissions.includes(k));
  if (!ok) {
    throw new AppError(
      "You do not have permission to perform this action",
      403,
      "FORBIDDEN",
    );
  }
}

export async function getAccessibleProject(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      _count: { select: { boards: true, members: true, tasks: true } },
    },
  });
  if (!project) {
    throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
  }

  const ws = await getWorkspaceMembership(userId, project.workspaceId);

  const projectMember = await prisma.projectMember.findUnique({
    where: {
      projectId_workspaceMemberId: {
        projectId,
        workspaceMemberId: ws.member.id,
      },
    },
  });

  const isWorkspaceVisible = project.visibility === "WORKSPACE";
  if (!projectMember && !isWorkspaceVisible && !ws.isOwner) {
    throw new AppError(
      "You do not have access to this project",
      403,
      "FORBIDDEN",
    );
  }

  return {
    project,
    workspaceCtx: ws,
    projectMember,
    isProjectOwner:
      project.ownerId === userId || projectMember?.role === "OWNER",
    canManageProject:
      ws.isOwner ||
      ws.permissions.includes("project:update") ||
      projectMember?.role === "OWNER" ||
      projectMember?.role === "PROJECT_MANAGER",
  };
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

export const DEFAULT_BOARD_COLUMNS = [
  { name: "Todo", position: 0, isDefault: true, isDone: false, color: "#94A3B8" },
  { name: "In Progress", position: 1, isDefault: false, isDone: false, color: "#3B82F6" },
  { name: "Review", position: 2, isDefault: false, isDone: false, color: "#F59E0B" },
  { name: "Done", position: 3, isDefault: false, isDone: true, color: "#22C55E" },
] as const;

export const DEFAULT_PROJECT_STATUSES = [
  { name: "Todo", color: "#94A3B8", position: 0, isDefault: true },
  { name: "In Progress", color: "#3B82F6", position: 1, isDefault: false },
  { name: "Review", color: "#F59E0B", position: 2, isDefault: false },
  { name: "Done", color: "#22C55E", position: 3, isDefault: false },
] as const;

export const DEFAULT_PROJECT_LABELS = [
  { name: "Bug", color: "#EF4444" },
  { name: "Feature", color: "#8B5CF6" },
  { name: "Improvement", color: "#06B6D4" },
] as const;
