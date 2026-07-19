import { ActivityAction, ActivityEntityType, TaskStatus } from "@prisma/client";
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
  isArchived?: boolean;
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
    isArchived: column.isArchived ?? false,
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
    where: { boardId: input.boardId, deletedAt: null, isArchived: false },
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
    where: { boardId, deletedAt: null, isArchived: false },
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
    where: { boardId: input.boardId, deletedAt: null, isArchived: false },
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

export async function copyColumn(
  userId: string,
  columnId: string,
  input: { name: string },
) {
  const source = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null, isArchived: false },
    include: {
      tasks: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        include: {
          labels: true,
          assignments: true,
        },
      },
    },
  });
  if (!source) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }

  const { board, access } = await getBoardAccess(userId, source.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to copy columns",
      403,
      "FORBIDDEN",
    );
  }

  const maxPos = await prisma.column.aggregate({
    where: { boardId: source.boardId, deletedAt: null, isArchived: false },
    _max: { position: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const column = await tx.column.create({
      data: {
        boardId: source.boardId,
        name: input.name,
        description: source.description,
        color: source.color,
        taskLimit: source.taskLimit,
        isDone: source.isDone,
        position: (maxPos._max.position ?? -1) + 1,
        createdBy: userId,
      },
    });

    for (let i = 0; i < source.tasks.length; i += 1) {
      const t = source.tasks[i]!;
      const count = await tx.task.count({ where: { projectId: board.projectId } });
      const copied = await tx.task.create({
        data: {
          workspaceId: board.project.workspaceId,
          projectId: board.projectId,
          boardId: source.boardId,
          columnId: column.id,
          createdBy: userId,
          code: `T-${count + 1}`,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          dueDate: t.dueDate,
          startDate: t.startDate,
          position: i,
          labels: t.labels.length
            ? { create: t.labels.map((l) => ({ labelId: l.labelId })) }
            : undefined,
          assignments: t.assignments.length
            ? {
                create: t.assignments.map((a) => ({
                  workspaceMemberId: a.workspaceMemberId,
                  assignedBy: userId,
                })),
              }
            : undefined,
        },
      });
      await tx.taskPosition.create({
        data: {
          taskId: copied.id,
          columnId: column.id,
          position: i,
          movedBy: userId,
        },
      });
    }

    await tx.activity.create({
      data: {
        workspaceId: board.project.workspaceId,
        projectId: board.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COLUMN,
        entityId: column.id,
        action: ActivityAction.CREATE,
        metadata: { type: "column_copied", fromColumnId: columnId },
        afterData: { name: column.name },
      },
    });

    return column;
  });

  return { ...publicColumn(created), columnId: created.id };
}

export async function moveColumn(
  userId: string,
  columnId: string,
  input: { boardId: string; position: number },
) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null, isArchived: false },
    include: { _count: { select: { tasks: true } } },
  });
  if (!column) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }

  const { board: sourceBoard, access: sourceAccess } = await getBoardAccess(
    userId,
    column.boardId,
  );
  const { board: destBoard, access: destAccess } = await getBoardAccess(
    userId,
    input.boardId,
  );

  if (!sourceAccess.canManageProject || !destAccess.canManageProject) {
    throw new AppError(
      "You do not have permission to move columns",
      403,
      "FORBIDDEN",
    );
  }

  if (sourceBoard.projectId !== destBoard.projectId) {
    throw new AppError(
      "Can only move columns between boards in the same project",
      400,
      "INVALID_MOVE",
    );
  }

  await prisma.$transaction(async (tx) => {
    // Free source position slots
    await tx.column.update({
      where: { id: columnId },
      data: { position: -1 - Date.now() % 100000, updatedBy: userId },
    });
    await tx.column.updateMany({
      where: {
        boardId: column.boardId,
        deletedAt: null,
        isArchived: false,
        position: { gt: column.position },
        id: { not: columnId },
      },
      data: { position: { decrement: 1 } },
    });

    // Make room at destination
    await tx.column.updateMany({
      where: {
        boardId: input.boardId,
        deletedAt: null,
        isArchived: false,
        position: { gte: input.position },
      },
      data: { position: { increment: 1 } },
    });

    await tx.column.update({
      where: { id: columnId },
      data: {
        boardId: input.boardId,
        position: input.position,
        updatedBy: userId,
      },
    });

    if (column.boardId !== input.boardId && column._count.tasks > 0) {
      await tx.task.updateMany({
        where: { columnId, deletedAt: null },
        data: { boardId: input.boardId, updatedBy: userId },
      });
    }

    await tx.activity.create({
      data: {
        workspaceId: destBoard.project.workspaceId,
        projectId: destBoard.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COLUMN,
        entityId: columnId,
        action: ActivityAction.MOVE,
        beforeData: { boardId: column.boardId, position: column.position },
        afterData: { boardId: input.boardId, position: input.position },
      },
    });
  });

  const updated = await prisma.column.findUniqueOrThrow({ where: { id: columnId } });
  return publicColumn(updated);
}

export async function moveAllTasksInColumn(
  userId: string,
  columnId: string,
  destinationColumnId: string,
) {
  if (columnId === destinationColumnId) {
    throw new AppError(
      "Source and destination columns must differ",
      400,
      "INVALID_MOVE",
    );
  }

  const source = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null, isArchived: false },
  });
  const dest = await prisma.column.findFirst({
    where: { id: destinationColumnId, deletedAt: null, isArchived: false },
  });
  if (!source || !dest) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }
  if (source.boardId !== dest.boardId) {
    throw new AppError(
      "Both columns must belong to the same board",
      400,
      "INVALID_MOVE",
    );
  }

  const { board, access } = await getBoardAccess(userId, source.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to move cards",
      403,
      "FORBIDDEN",
    );
  }

  const tasks = await prisma.task.findMany({
    where: { columnId, deletedAt: null },
    orderBy: { position: "asc" },
  });

  const maxPos = await prisma.task.aggregate({
    where: { columnId: destinationColumnId, deletedAt: null },
    _max: { position: true },
  });
  let nextPos = (maxPos._max.position ?? -1) + 1;

  await prisma.$transaction(async (tx) => {
    for (const task of tasks) {
      await tx.task.update({
        where: { id: task.id },
        data: {
          columnId: destinationColumnId,
          position: nextPos,
          updatedBy: userId,
          ...(dest.isDone
            ? { status: TaskStatus.DONE, completedAt: task.completedAt ?? new Date() }
            : {}),
        },
      });
      await tx.taskPosition.create({
        data: {
          taskId: task.id,
          columnId: destinationColumnId,
          position: nextPos,
          movedBy: userId,
        },
      });
      nextPos += 1;
    }

    await tx.activity.create({
      data: {
        workspaceId: board.project.workspaceId,
        projectId: board.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COLUMN,
        entityId: columnId,
        action: ActivityAction.MOVE,
        metadata: {
          type: "move_all_cards",
          toColumnId: destinationColumnId,
          count: tasks.length,
        },
      },
    });
  });

  return { message: `Moved ${tasks.length} cards`, count: tasks.length };
}

export async function sortColumnTasks(
  userId: string,
  columnId: string,
  sortBy: "created_desc" | "created_asc" | "name_asc",
) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null, isArchived: false },
  });
  if (!column) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }

  const { board, access } = await getBoardAccess(userId, column.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to sort columns",
      403,
      "FORBIDDEN",
    );
  }

  const orderBy =
    sortBy === "created_desc"
      ? ({ createdAt: "desc" } as const)
      : sortBy === "created_asc"
        ? ({ createdAt: "asc" } as const)
        : ({ title: "asc" } as const);

  const tasks = await prisma.task.findMany({
    where: { columnId, deletedAt: null },
    orderBy,
  });

  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < tasks.length; i += 1) {
      await tx.task.update({
        where: { id: tasks[i]!.id },
        data: { position: i + 1000 },
      });
    }
    for (let i = 0; i < tasks.length; i += 1) {
      await tx.task.update({
        where: { id: tasks[i]!.id },
        data: { position: i, updatedBy: userId },
      });
    }
    await tx.activity.create({
      data: {
        workspaceId: board.project.workspaceId,
        projectId: board.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COLUMN,
        entityId: columnId,
        action: ActivityAction.UPDATE,
        metadata: { type: "column_sorted", sortBy },
      },
    });
  });

  return { message: "Column sorted", count: tasks.length };
}

export async function archiveColumn(userId: string, columnId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null, isArchived: false },
  });
  if (!column) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }
  if (column.isDefault) {
    throw new AppError(
      "Cannot archive the default column",
      400,
      "CANNOT_ARCHIVE_DEFAULT_COLUMN",
    );
  }

  const { board, access } = await getBoardAccess(userId, column.boardId);
  if (!access.canManageProject) {
    throw new AppError(
      "You do not have permission to archive columns",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.column.update({
    where: { id: columnId },
    data: { isArchived: true, updatedBy: userId },
  });

  await prisma.activity.create({
    data: {
      workspaceId: board.project.workspaceId,
      projectId: board.projectId,
      actorId: userId,
      entityType: ActivityEntityType.COLUMN,
      entityId: columnId,
      action: ActivityAction.ARCHIVE,
      beforeData: { name: column.name },
    },
  });

  return { message: "Column archived successfully" };
}
