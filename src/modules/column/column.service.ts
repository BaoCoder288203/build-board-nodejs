import { ActivityAction, ActivityEntityType } from "@prisma/client";
import { getAccessibleProject } from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type {
  CreateColumnInput,
  ReorderColumnsInput,
  UpdateColumnInput,
} from "./column.schema.js";

async function getBoardAccess(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    include: { project: true },
  });
  if (!board) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }
  const access = await getAccessibleProject(userId, board.projectId);
  return { board, access };
}

function publicColumn(column: {
  id: string;
  boardId: string;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  taskLimit: number | null;
  isDefault: boolean;
  isDone: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: column.id,
    boardId: column.boardId,
    name: column.name,
    description: column.description,
    color: column.color,
    position: column.position,
    taskLimit: column.taskLimit,
    isDefault: column.isDefault,
    isDone: column.isDone,
    createdAt: column.createdAt,
    updatedAt: column.updatedAt,
  };
}

export async function createColumn(userId: string, input: CreateColumnInput) {
  const { board, access } = await getBoardAccess(userId, input.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to create columns",
      403,
      "FORBIDDEN",
    );
  }

  const maxPos = await prisma.column.aggregate({
    where: { boardId: input.boardId, deletedAt: null },
    _max: { position: true },
  });

  const column = await prisma.column.create({
    data: {
      boardId: input.boardId,
      name: input.name,
      color: input.color ?? null,
      description: input.description ?? null,
      taskLimit: input.taskLimit ?? null,
      position: (maxPos._max.position ?? -1) + 1,
      createdBy: userId,
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: board.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.COLUMN,
      entityId: column.id,
      action: ActivityAction.CREATE,
      afterData: { name: column.name },
    },
  });

  return { ...publicColumn(column), columnId: column.id };
}

export async function listColumns(userId: string, boardId: string) {
  await getBoardAccess(userId, boardId);
  const columns = await prisma.column.findMany({
    where: { boardId, deletedAt: null },
    orderBy: { position: "asc" },
    include: { _count: { select: { tasks: true } } },
  });

  return columns.map((c) => ({
    ...publicColumn(c),
    tasksCount: c._count.tasks,
  }));
}

export async function updateColumn(
  userId: string,
  columnId: string,
  input: UpdateColumnInput,
) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null },
  });
  if (!column) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }
  const { board, access } = await getBoardAccess(userId, column.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to update columns",
      403,
      "FORBIDDEN",
    );
  }

  const updated = await prisma.column.update({
    where: { id: columnId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.taskLimit !== undefined ? { taskLimit: input.taskLimit } : {}),
      ...(input.isDone !== undefined ? { isDone: input.isDone } : {}),
      updatedBy: userId,
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: board.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.COLUMN,
      entityId: columnId,
      action: ActivityAction.UPDATE,
      afterData: input,
    },
  });

  return publicColumn(updated);
}

export async function reorderColumns(userId: string, input: ReorderColumnsInput) {
  const { board, access } = await getBoardAccess(userId, input.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to reorder columns",
      403,
      "FORBIDDEN",
    );
  }

  const existing = await prisma.column.findMany({
    where: { boardId: input.boardId, deletedAt: null },
  });
  if (existing.length !== input.columnIds.length) {
    throw new AppError(
      "columnIds must include every column on the board",
      400,
      "INVALID_REORDER",
    );
  }
  const existingIds = new Set(existing.map((c) => c.id));
  for (const id of input.columnIds) {
    if (!existingIds.has(id)) {
      throw new AppError(
        "One or more column ids do not belong to this board",
        400,
        "INVALID_REORDER",
      );
    }
  }

  // Two-phase update to avoid unique (boardId, position) collisions
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < input.columnIds.length; i += 1) {
      await tx.column.update({
        where: { id: input.columnIds[i] },
        data: { position: i + 1000, updatedBy: userId },
      });
    }
    for (let i = 0; i < input.columnIds.length; i += 1) {
      await tx.column.update({
        where: { id: input.columnIds[i] },
        data: { position: i },
      });
    }
    await tx.activity.create({
      data: {
        workspaceId: board.project.workspaceId,
        projectId: board.projectId,
        actorId: userId,
        entityType: ActivityEntityType.BOARD,
        entityId: input.boardId,
        action: ActivityAction.UPDATE,
        metadata: { type: "columns_reordered" },
      },
    });
  });

  return listColumns(userId, input.boardId);
}

export async function deleteColumn(userId: string, columnId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null },
    include: { _count: { select: { tasks: true } } },
  });
  if (!column) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }
  if (column.isDefault) {
    throw new AppError(
      "Cannot delete the default column",
      400,
      "CANNOT_DELETE_DEFAULT_COLUMN",
    );
  }
  if (column._count.tasks > 0) {
    throw new AppError(
      "Move or delete tasks in this column before removing it",
      400,
      "COLUMN_HAS_TASKS",
    );
  }

  const { board, access } = await getBoardAccess(userId, column.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to delete columns",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.column.update({
    where: { id: columnId },
    data: { deletedAt: new Date(), updatedBy: userId },
  });

  await prisma.activity.create({
    data: {
      workspaceId: board.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.COLUMN,
      entityId: columnId,
      action: ActivityAction.DELETE,
    },
  });

  return { message: "Column deleted successfully" };
}
