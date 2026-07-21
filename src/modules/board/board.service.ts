import { ActivityAction, ActivityEntityType } from "@prisma/client";
import {
  DEFAULT_BOARD_COLUMNS,
  getAccessibleProject,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import {
  buildBoardCoverUrl,
  resolveBoardCover,
} from "../../common/visual-identity.js";
import type { CreateBoardInput, UpdateBoardInput } from "./board.schema.js";

function publicBoard(
  board: {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    icon: string | null;
    color: string | null;
    coverUrl?: string | null;
    position: number;
    isDefault: boolean;
    isArchived: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  extras?: Record<string, unknown>,
) {
  const visual = resolveBoardCover(board);
  return {
    id: board.id,
    projectId: board.projectId,
    name: board.name,
    description: board.description,
    icon: board.icon,
    color: board.color,
    coverUrl: visual.coverUrl,
    position: board.position,
    isDefault: board.isDefault,
    isArchived: board.isArchived,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    ...extras,
  };
}

async function assertCanManageBoard(userId: string, projectId: string) {
  const access = await getAccessibleProject(userId, projectId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to manage boards in this project",
      403,
      "FORBIDDEN",
    );
  }
  return access;
}

export async function createBoard(userId: string, input: CreateBoardInput) {
  const access = await assertCanManageBoard(userId, input.projectId);

  const maxPos = await prisma.board.aggregate({
    where: { projectId: input.projectId, deletedAt: null },
    _max: { position: true },
  });

  const boardId = crypto.randomUUID();
  const board = await prisma.board.create({
    data: {
      id: boardId,
      projectId: input.projectId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? access.project.color,
      coverUrl: buildBoardCoverUrl(boardId),
      icon: input.icon ?? null,
      position: (maxPos._max.position ?? -1) + 1,
      isDefault: false,
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
    include: {
      _count: { select: { columns: true, tasks: true } },
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: access.project.workspaceId,
      projectId: input.projectId,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: board.id,
      action: ActivityAction.CREATE,
      afterData: { name: board.name },
    },
  });

  return publicBoard(board, {
    boardId: board.id,
    columnsCount: board._count.columns,
    tasksCount: board._count.tasks,
  });
}

export async function listBoards(
  userId: string,
  projectId: string,
  page = 1,
  limit = 20,
) {
  await getAccessibleProject(userId, projectId);
  const skip = (page - 1) * limit;
  const where = {
    projectId,
    deletedAt: null,
    isArchived: false,
  };

  const [total, rows] = await Promise.all([
    prisma.board.count({ where }),
    prisma.board.findMany({
      where,
      skip,
      take: limit,
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { columns: true, tasks: true } } },
    }),
  ]);

  return {
    items: rows.map((b) =>
      publicBoard(b, {
        columnsCount: b._count.columns,
        tasksCount: b._count.tasks,
      }),
    ),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getBoard(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    include: {
      columns: {
        where: { deletedAt: null, isArchived: false },
        orderBy: { position: "asc" },
        include: {
          _count: { select: { tasks: true } },
          tasks: {
            where: { deletedAt: null },
            orderBy: { position: "asc" },
            include: {
              assignments: {
                include: {
                  workspaceMember: {
                    include: {
                      user: {
                        select: {
                          id: true,
                          fullName: true,
                          email: true,
                          avatarUrl: true,
                        },
                      },
                    },
                  },
                },
              },
              labels: {
                include: {
                  label: {
                    select: { id: true, name: true, color: true },
                  },
                },
              },
              checklists: {
                where: { deletedAt: null },
                select: {
                  items: {
                    where: { deletedAt: null },
                    select: { isCompleted: true },
                  },
                },
              },
              _count: {
                select: {
                  comments: { where: { deletedAt: null } },
                  attachments: {
                    where: { deletedAt: null, commentId: null },
                  },
                },
              },
            },
          },
        },
      },
      _count: { select: { tasks: true } },
      project: { select: { id: true, name: true, workspaceId: true } },
    },
  });
  if (!board) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }

  await getAccessibleProject(userId, board.projectId);

  return publicBoard(board, {
    project: board.project,
    tasksCount: board._count.tasks,
    columns: board.columns.map((c) => ({
      id: c.id,
      boardId: c.boardId,
      name: c.name,
      description: c.description,
      color: c.color,
      position: c.position,
      taskLimit: c.taskLimit,
      isDefault: c.isDefault,
      isDone: c.isDone,
      tasksCount: c.tasks.length,
      tasks: c.tasks.map((t) => {
        const checklistItems = t.checklists.flatMap((cl) => cl.items);
        const checklistTotal = checklistItems.length;
        const checklistCompleted = checklistItems.filter(
          (i) => i.isCompleted,
        ).length;
        return {
          id: t.id,
          taskId: t.id,
          columnId: t.columnId,
          code: t.code,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
          position: t.position,
          createdAt: t.createdAt,
          assignees: t.assignments.map((a) => ({
            workspaceMemberId: a.workspaceMemberId,
            user: a.workspaceMember.user,
          })),
          labels: t.labels.map((l) => l.label),
          checklistProgress:
            checklistTotal > 0
              ? {
                  completed: checklistCompleted,
                  total: checklistTotal,
                  progress: Math.round(
                    (checklistCompleted / checklistTotal) * 100,
                  ),
                }
              : null,
          commentsCount: t._count.comments,
          attachmentsCount: t._count.attachments,
        };
      }),
    })),
  });
}

export async function updateBoard(
  userId: string,
  boardId: string,
  input: UpdateBoardInput,
) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
  });
  if (!board) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }
  const access = await assertCanManageBoard(userId, board.projectId);

  const updated = await prisma.board.update({
    where: { id: boardId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      updatedBy: userId,
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: access.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: boardId,
      action: ActivityAction.UPDATE,
      afterData: input,
    },
  });

  return publicBoard(updated);
}

export async function archiveBoard(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
  });
  if (!board) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }
  if (board.isDefault) {
    throw new AppError(
      "Cannot archive the default board",
      400,
      "CANNOT_ARCHIVE_DEFAULT_BOARD",
    );
  }
  const access = await assertCanManageBoard(userId, board.projectId);

  await prisma.board.update({
    where: { id: boardId },
    data: { isArchived: true, updatedBy: userId },
  });

  await prisma.activity.create({
    data: {
      workspaceId: access.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: boardId,
      action: ActivityAction.ARCHIVE,
    },
  });

  return { message: "Board archived successfully" };
}

export async function deleteBoard(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
  });
  if (!board) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }
  if (board.isDefault) {
    throw new AppError(
      "Cannot delete the default board",
      400,
      "CANNOT_DELETE_DEFAULT_BOARD",
    );
  }
  const access = await assertCanManageBoard(userId, board.projectId);

  await prisma.board.update({
    where: { id: boardId },
    data: { deletedAt: new Date(), updatedBy: userId },
  });

  await prisma.activity.create({
    data: {
      workspaceId: access.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: boardId,
      action: ActivityAction.DELETE,
    },
  });

  return { message: "Board deleted successfully" };
}
