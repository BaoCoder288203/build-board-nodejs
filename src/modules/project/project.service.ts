import {
  ActivityAction,
  ActivityEntityType,
  ProjectMemberRole,
  ProjectVisibility,
} from "@prisma/client";
import {
  assertPermission,
  DEFAULT_BOARD_COLUMNS,
  DEFAULT_PROJECT_LABELS,
  DEFAULT_PROJECT_STATUSES,
  getAccessibleProject,
  getWorkspaceMembership,
  slugify,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import {
  buildBoardCoverUrl,
  extractProjectInitial,
  pickWorkspaceTheme,
  resolveProjectTheme,
  resolveWorkspaceTheme,
} from "../../common/visual-identity.js";
import type { CreateProjectInput, UpdateProjectInput } from "./project.schema.js";

function publicProject(
  project: {
    id: string;
    workspaceId: string;
    ownerId: string;
    name: string;
    slug: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    themeColorFrom?: string | null;
    themeColorTo?: string | null;
    visibility: ProjectVisibility;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  extras?: Record<string, unknown>,
) {
  const visual = resolveProjectTheme(project);
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    ownerId: project.ownerId,
    name: project.name,
    slug: project.slug,
    description: project.description,
    icon: visual.icon,
    color: visual.themeColorFrom,
    themeColorFrom: visual.themeColorFrom,
    themeColorTo: visual.themeColorTo,
    visibility: project.visibility,
    archivedAt: project.archivedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...extras,
  };
}

export async function createProject(userId: string, input: CreateProjectInput) {
  const ws = await getWorkspaceMembership(userId, input.workspaceId);
  assertPermission(ws, "project:create");

  const slug = (input.slug ?? slugify(input.name)) || `project-${Date.now()}`;
  const existing = await prisma.project.findUnique({
    where: {
      workspaceId_slug: { workspaceId: input.workspaceId, slug },
    },
  });
  if (existing && !existing.deletedAt) {
    throw new AppError(
      "A project with this slug already exists in the workspace",
      409,
      "PROJECT_SLUG_EXISTS",
    );
  }

  const project = await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findFirst({
      where: { id: input.workspaceId, deletedAt: null },
      select: {
        themeColorFrom: true,
        themeColorTo: true,
      },
    });
    const workspaceTheme = workspace
      ? resolveWorkspaceTheme({ id: input.workspaceId, ...workspace })
      : pickWorkspaceTheme(input.workspaceId);
    const projectTheme = {
      themeColorFrom: input.color ?? workspaceTheme.themeColorFrom,
      themeColorTo: workspaceTheme.themeColorTo,
    };

    const created = await tx.project.create({
      data: {
        workspaceId: input.workspaceId,
        ownerId: userId,
        name: input.name,
        slug,
        description: input.description ?? null,
        visibility: input.visibility,
        color: projectTheme.themeColorFrom,
        themeColorFrom: projectTheme.themeColorFrom,
        themeColorTo: projectTheme.themeColorTo,
        icon: input.icon ?? extractProjectInitial(input.name),
        statuses: {
          create: DEFAULT_PROJECT_STATUSES.map((s) => ({ ...s })),
        },
        labels: {
          create: DEFAULT_PROJECT_LABELS.map((l) => ({ ...l })),
        },
        members: {
          create: {
            workspaceMemberId: ws.member.id,
            role: ProjectMemberRole.OWNER,
          },
        },
      },
    });

    const mainBoardId = crypto.randomUUID();
    await tx.board.create({
      data: {
        id: mainBoardId,
        projectId: created.id,
        name: "Main Board",
        position: 0,
        isDefault: true,
        color: created.color,
        coverUrl: buildBoardCoverUrl(mainBoardId),
        createdBy: userId,
        columns: {
          create: DEFAULT_BOARD_COLUMNS.map((col) => ({
            name: col.name,
            position: col.position,
            color: col.color,
            isDefault: col.isDefault,
            isDone: col.isDone,
            createdBy: userId,
          })),
        },
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: input.workspaceId,
        projectId: created.id,
        actorId: userId,
        entityType: ActivityEntityType.PROJECT,
        entityId: created.id,
        action: ActivityAction.CREATE,
        afterData: { name: created.name, slug: created.slug },
      },
    });

    return created;
  });

  return publicProject(project, { projectId: project.id });
}

export async function listProjects(
  userId: string,
  workspaceId: string,
  page = 1,
  limit = 20,
  search?: string,
) {
  const ws = await getWorkspaceMembership(userId, workspaceId);
  const skip = (page - 1) * limit;

  const where = {
    workspaceId,
    deletedAt: null,
    archivedAt: null,
    AND: [
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { slug: { contains: search, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
      {
        OR: [
          { visibility: ProjectVisibility.WORKSPACE },
          { ownerId: userId },
          {
            members: {
              some: { workspaceMemberId: ws.member.id },
            },
          },
        ],
      },
    ],
  };

  const [total, rows] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { boards: true, members: true, tasks: true } },
      },
    }),
  ]);

  return {
    items: rows.map((p) =>
      publicProject(p, {
        boardsCount: p._count.boards,
        membersCount: p._count.members,
        tasksCount: p._count.tasks,
      }),
    ),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getProject(userId: string, projectId: string) {
  const { project, projectMember, isProjectOwner, canManageProject } =
    await getAccessibleProject(userId, projectId);

  const defaultBoard = await prisma.board.findFirst({
    where: { projectId, deletedAt: null, isArchived: false },
    orderBy: [{ isDefault: "desc" }, { position: "asc" }],
  });

  return publicProject(project, {
    boardsCount: project._count.boards,
    membersCount: project._count.members,
    tasksCount: project._count.tasks,
    defaultBoardId: defaultBoard?.id ?? null,
    myRole: projectMember?.role ?? (isProjectOwner ? "OWNER" : null),
    canManage: canManageProject,
  });
}

export async function updateProject(
  userId: string,
  projectId: string,
  input: UpdateProjectInput,
) {
  const { project, canManageProject } = await getAccessibleProject(userId, projectId);
  if (!canManageProject) {
    throw new AppError(
      "You do not have permission to update this project",
      403,
      "FORBIDDEN",
    );
  }

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: project.workspaceId,
      projectId,
      actorId: userId,
      entityType: ActivityEntityType.PROJECT,
      entityId: projectId,
      action: ActivityAction.UPDATE,
      afterData: input,
    },
  });

  return publicProject(updated);
}

export async function archiveProject(userId: string, projectId: string) {
  const { project, canManageProject } = await getAccessibleProject(userId, projectId);
  if (!canManageProject) {
    throw new AppError(
      "You do not have permission to archive this project",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { archivedAt: new Date() },
  });

  await prisma.activity.create({
    data: {
      workspaceId: project.workspaceId,
      projectId,
      actorId: userId,
      entityType: ActivityEntityType.PROJECT,
      entityId: projectId,
      action: ActivityAction.ARCHIVE,
    },
  });

  return { message: "Project archived successfully" };
}

export async function deleteProject(userId: string, projectId: string) {
  const { project, isProjectOwner, workspaceCtx } = await getAccessibleProject(
    userId,
    projectId,
  );
  if (!isProjectOwner && !workspaceCtx.isOwner) {
    throw new AppError(
      "Only the project owner can delete this project",
      403,
      "FORBIDDEN",
    );
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: { deletedAt: now },
    });
    await tx.board.updateMany({
      where: { projectId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.activity.create({
      data: {
        workspaceId: project.workspaceId,
        projectId,
        actorId: userId,
        entityType: ActivityEntityType.PROJECT,
        entityId: projectId,
        action: ActivityAction.DELETE,
      },
    });
  });

  return { message: "Project deleted successfully" };
}
