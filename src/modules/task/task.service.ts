import {
  ActivityAction,
  ActivityEntityType,
  NotificationEntityType,
  NotificationType,
  TaskPriority,
  TaskStatus,
  type Prisma,
} from "@prisma/client";
import {
  assertPermission,
  getAccessibleProject,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { notifyUser } from "../../common/notify.js";
import { prisma } from "../../database/prisma.js";
import type {
  CreateTaskInput,
  MoveTaskInput,
  UpdateTaskInput,
} from "./task.schema.js";

const taskCardInclude = {
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
} satisfies Prisma.TaskInclude;

function publicTask(
  task: Prisma.TaskGetPayload<{ include: typeof taskCardInclude }>,
) {
  return {
    id: task.id,
    taskId: task.id,
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    boardId: task.boardId,
    columnId: task.columnId,
    code: task.code,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    startDate: task.startDate,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    coverImage: task.coverImage,
    position: task.position,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    assignees: task.assignments.map((a) => ({
      workspaceMemberId: a.workspaceMemberId,
      assignedAt: a.assignedAt,
      user: a.workspaceMember.user,
    })),
    labels: task.labels.map((l) => l.label),
  };
}

async function getColumnContext(columnId: string) {
  const column = await prisma.column.findFirst({
    where: { id: columnId, deletedAt: null },
    include: {
      board: {
        include: { project: true },
      },
    },
  });
  if (!column || column.board.deletedAt) {
    throw new AppError("Column not found", 404, "COLUMN_NOT_FOUND");
  }
  return column;
}

async function getTaskOrThrow(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    include: taskCardInclude,
  });
  if (!task) {
    throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
  }
  return task;
}

async function assertTaskAccess(
  userId: string,
  projectId: string,
  permission?: string,
) {
  const access = await getAccessibleProject(userId, projectId);
  if (permission) {
    assertPermission(access.workspaceCtx, permission);
  }
  return access;
}

async function nextTaskCode(projectId: string) {
  const count = await prisma.task.count({ where: { projectId } });
  return `T-${count + 1}`;
}

async function resolveAssigneeMemberIds(
  workspaceId: string,
  userIds: string[],
) {
  if (!userIds.length) return [] as string[];
  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      userId: { in: userIds },
    },
    select: { id: true, userId: true },
  });
  if (members.length !== userIds.length) {
    throw new AppError(
      "One or more assignees are not workspace members",
      400,
      "INVALID_ASSIGNEE",
    );
  }
  return members.map((m) => m.id);
}

export async function createTask(userId: string, input: CreateTaskInput) {
  const column = await getColumnContext(input.columnId);
  const access = await assertTaskAccess(
    userId,
    column.board.projectId,
    "task:create",
  );

  if (column.taskLimit != null) {
    const current = await prisma.task.count({
      where: { columnId: column.id, deletedAt: null },
    });
    if (current >= column.taskLimit) {
      throw new AppError(
        "This column has reached its task limit",
        400,
        "COLUMN_TASK_LIMIT",
      );
    }
  }

  const assigneeMemberIds = await resolveAssigneeMemberIds(
    column.board.project.workspaceId,
    input.assigneeUserIds ?? [],
  );

  if (input.labelIds?.length) {
    const labels = await prisma.projectLabel.findMany({
      where: {
        id: { in: input.labelIds },
        projectId: column.board.projectId,
      },
    });
    if (labels.length !== input.labelIds.length) {
      throw new AppError(
        "One or more labels do not belong to this project",
        400,
        "INVALID_LABEL",
      );
    }
  }

  const maxPos = await prisma.task.aggregate({
    where: { columnId: column.id, deletedAt: null },
    _max: { position: true },
  });

  const code = await nextTaskCode(column.board.projectId);
  const priority = (input.priority as TaskPriority | undefined) ?? TaskPriority.MEDIUM;
  const status = (input.status as TaskStatus | undefined) ?? TaskStatus.TODO;

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        workspaceId: column.board.project.workspaceId,
        projectId: column.board.projectId,
        boardId: column.boardId,
        columnId: column.id,
        createdBy: userId,
        code,
        title: input.title,
        description: input.description ?? null,
        priority,
        status,
        dueDate: input.dueDate ?? null,
        position: (maxPos._max.position ?? -1) + 1,
        completedAt: status === TaskStatus.DONE ? new Date() : null,
        assignments: assigneeMemberIds.length
          ? {
              create: assigneeMemberIds.map((workspaceMemberId) => ({
                workspaceMemberId,
                assignedBy: userId,
              })),
            }
          : undefined,
        labels: input.labelIds?.length
          ? {
              create: input.labelIds.map((labelId) => ({ labelId })),
            }
          : undefined,
      },
      include: taskCardInclude,
    });

    await tx.taskPosition.create({
      data: {
        taskId: created.id,
        columnId: column.id,
        position: created.position,
        movedBy: userId,
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: column.board.project.workspaceId,
        projectId: column.board.projectId,
        actorId: userId,
        entityType: ActivityEntityType.TASK,
        entityId: created.id,
        action: ActivityAction.CREATE,
        afterData: { title: created.title, code: created.code },
      },
    });

    return created;
  });

  return publicTask(task);
}

export async function listTasks(
  userId: string,
  query: {
    boardId?: string;
    columnId?: string;
    projectId?: string;
    priority?: string;
    status?: string;
    search?: string;
    page: number;
    limit: number;
  },
) {
  let projectId = query.projectId;

  if (query.columnId) {
    const column = await getColumnContext(query.columnId);
    projectId = column.board.projectId;
  } else if (query.boardId) {
    const board = await prisma.board.findFirst({
      where: { id: query.boardId, deletedAt: null },
    });
    if (!board) throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
    projectId = board.projectId;
  }

  if (!projectId) {
    throw new AppError("projectId is required", 400, "VALIDATION_ERROR");
  }

  await assertTaskAccess(userId, projectId);

  const where: Prisma.TaskWhereInput = {
    projectId,
    deletedAt: null,
    ...(query.boardId ? { boardId: query.boardId } : {}),
    ...(query.columnId ? { columnId: query.columnId } : {}),
    ...(query.priority ? { priority: query.priority as TaskPriority } : {}),
    ...(query.status ? { status: query.status as TaskStatus } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: "insensitive" } },
            { code: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const skip = (query.page - 1) * query.limit;
  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: [{ columnId: "asc" }, { position: "asc" }],
      include: taskCardInclude,
    }),
  ]);

  return {
    items: rows.map(publicTask),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function getTask(userId: string, taskId: string) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId);
  return publicTask(task);
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
) {
  const existing = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, existing.projectId, "task:update");

  const nextStatus = input.status as TaskStatus | undefined;
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined
        ? { priority: input.priority as TaskPriority }
        : {}),
      ...(nextStatus !== undefined
        ? {
            status: nextStatus,
            completedAt:
              nextStatus === TaskStatus.DONE
                ? existing.completedAt ?? new Date()
                : null,
          }
        : {}),
      ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
      ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
      updatedBy: userId,
    },
    include: taskCardInclude,
  });

  await prisma.activity.create({
    data: {
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATE,
      beforeData: {
        title: existing.title,
        priority: existing.priority,
        status: existing.status,
      },
      afterData: input,
    },
  });

  return publicTask(updated);
}

export async function deleteTask(userId: string, taskId: string) {
  const existing = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, existing.projectId, "task:delete");

  await prisma.task.update({
    where: { id: taskId },
    data: { deletedAt: new Date(), updatedBy: userId },
  });

  await prisma.activity.create({
    data: {
      workspaceId: existing.workspaceId,
      projectId: existing.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.DELETE,
      beforeData: { title: existing.title, code: existing.code },
    },
  });

  return { message: "Task deleted successfully" };
}

export async function moveTask(
  userId: string,
  taskId: string,
  input: MoveTaskInput,
) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  if (input.sourceColumnId && input.sourceColumnId !== task.columnId) {
    throw new AppError(
      "Task is not in the source column",
      400,
      "INVALID_MOVE",
    );
  }

  const destColumn = await getColumnContext(input.destinationColumnId);
  if (destColumn.boardId !== task.boardId) {
    throw new AppError(
      "Destination column must belong to the same board",
      400,
      "INVALID_MOVE",
    );
  }

  if (
    destColumn.taskLimit != null &&
    destColumn.id !== task.columnId
  ) {
    const current = await prisma.task.count({
      where: { columnId: destColumn.id, deletedAt: null },
    });
    if (current >= destColumn.taskLimit) {
      throw new AppError(
        "Destination column has reached its task limit",
        400,
        "COLUMN_TASK_LIMIT",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    const sourceColumnId = task.columnId;
    const destColumnId = destColumn.id;

    // Remove from source ordering
    await tx.task.update({
      where: { id: taskId },
      data: { position: -1, updatedBy: userId },
    });

    await tx.task.updateMany({
      where: {
        columnId: sourceColumnId,
        deletedAt: null,
        position: { gt: task.position },
        id: { not: taskId },
      },
      data: { position: { decrement: 1 } },
    });

    // Make room in destination
    await tx.task.updateMany({
      where: {
        columnId: destColumnId,
        deletedAt: null,
        position: { gte: input.newPosition },
        id: { not: taskId },
      },
      data: { position: { increment: 1 } },
    });

    const nextStatus =
      destColumn.isDone && task.status !== TaskStatus.DONE
        ? TaskStatus.DONE
        : !destColumn.isDone && task.status === TaskStatus.DONE
          ? TaskStatus.IN_PROGRESS
          : undefined;

    await tx.task.update({
      where: { id: taskId },
      data: {
        columnId: destColumnId,
        position: input.newPosition,
        updatedBy: userId,
        ...(nextStatus
          ? {
              status: nextStatus,
              completedAt:
                nextStatus === TaskStatus.DONE ? new Date() : null,
            }
          : {}),
      },
    });

    await tx.taskPosition.create({
      data: {
        taskId,
        columnId: destColumnId,
        position: input.newPosition,
        movedBy: userId,
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.TASK,
        entityId: taskId,
        action: ActivityAction.MOVE,
        beforeData: { columnId: sourceColumnId, position: task.position },
        afterData: {
          columnId: destColumnId,
          position: input.newPosition,
        },
      },
    });
  });

  return getTask(userId, taskId);
}

export async function assignTask(
  userId: string,
  taskId: string,
  assigneeUserId: string,
) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  const memberIds = await resolveAssigneeMemberIds(task.workspaceId, [
    assigneeUserId,
  ]);
  const workspaceMemberId = memberIds[0]!;

  await prisma.taskAssignment.upsert({
    where: {
      taskId_workspaceMemberId: {
        taskId,
        workspaceMemberId,
      },
    },
    create: {
      taskId,
      workspaceMemberId,
      assignedBy: userId,
    },
    update: {},
  });

  await prisma.activity.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.ASSIGN,
      afterData: { userId: assigneeUserId },
    },
  });

  if (assigneeUserId !== userId) {
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await notifyUser({
      workspaceId: task.workspaceId,
      recipientId: assigneeUserId,
      senderId: userId,
      entityType: NotificationEntityType.TASK,
      entityId: taskId,
      notificationType: NotificationType.TASK_ASSIGNED,
      title: "Task assigned to you",
      message: `${actor?.fullName ?? "Someone"} assigned you to “${task.title}”.`,
      metadata: { taskId, boardId: task.boardId },
    });
  }

  return getTask(userId, taskId);
}

export async function unassignTask(
  userId: string,
  taskId: string,
  assigneeUserId: string,
) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: task.workspaceId, userId: assigneeUserId },
  });
  if (!member) {
    throw new AppError("Assignee is not a workspace member", 404, "NOT_FOUND");
  }

  await prisma.taskAssignment.deleteMany({
    where: { taskId, workspaceMemberId: member.id },
  });

  await prisma.activity.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UNASSIGN,
      afterData: { userId: assigneeUserId },
    },
  });

  if (assigneeUserId !== userId) {
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    await notifyUser({
      workspaceId: task.workspaceId,
      recipientId: assigneeUserId,
      senderId: userId,
      entityType: NotificationEntityType.TASK,
      entityId: taskId,
      notificationType: NotificationType.TASK_UNASSIGNED,
      title: "Removed from a task",
      message: `${actor?.fullName ?? "Someone"} unassigned you from “${task.title}”.`,
      metadata: { taskId, boardId: task.boardId },
    });
  }

  return getTask(userId, taskId);
}

export async function addTaskLabel(
  userId: string,
  taskId: string,
  labelId: string,
) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  const label = await prisma.projectLabel.findFirst({
    where: { id: labelId, projectId: task.projectId },
  });
  if (!label) {
    throw new AppError("Label not found in this project", 404, "LABEL_NOT_FOUND");
  }

  await prisma.taskLabel.upsert({
    where: { taskId_labelId: { taskId, labelId } },
    create: { taskId, labelId },
    update: {},
  });

  return getTask(userId, taskId);
}

export async function removeTaskLabel(
  userId: string,
  taskId: string,
  labelId: string,
) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  await prisma.taskLabel.deleteMany({ where: { taskId, labelId } });
  return getTask(userId, taskId);
}

export async function listProjectLabels(userId: string, projectId: string) {
  await assertTaskAccess(userId, projectId);
  const labels = await prisma.projectLabel.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
  });
  return labels.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description,
  }));
}
