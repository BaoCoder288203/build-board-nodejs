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
  getWorkspaceMembership,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { notifyUser } from "../../common/notify.js";
import { prisma } from "../../database/prisma.js";
import type {
  CalendarTasksQuery,
  CreateProjectLabelInput,
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
  watchers: {
    select: {
      workspaceMemberId: true,
    },
  },
} satisfies Prisma.TaskInclude;

function publicTask(
  task: Prisma.TaskGetPayload<{ include: typeof taskCardInclude }>,
  viewerWorkspaceMemberId?: string,
) {
  const isWatching = viewerWorkspaceMemberId
    ? task.watchers.some((w) => w.workspaceMemberId === viewerWorkspaceMemberId)
    : false;
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
    isPinned: task.isPinned,
    isWatching,
    watchersCount: task.watchers.length,
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

async function notifyTaskWatchers(input: {
  taskId: string;
  workspaceId: string;
  actorId: string;
  entityId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const watchers = await prisma.taskWatcher.findMany({
    where: { taskId: input.taskId },
    include: {
      workspaceMember: {
        select: { userId: true },
      },
    },
  });
  const recipients = [
    ...new Set(
      watchers
        .map((w) => w.workspaceMember.userId)
        .filter((userId) => userId !== input.actorId),
    ),
  ];
  for (const recipientId of recipients) {
    await notifyUser({
      workspaceId: input.workspaceId,
      recipientId,
      senderId: input.actorId,
      entityType: NotificationEntityType.TASK,
      entityId: input.entityId,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message,
      metadata: input.metadata,
    });
  }
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

  return publicTask(task, access.workspaceCtx.member.id);
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

  const access = await assertTaskAccess(userId, projectId);

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
      orderBy: [{ columnId: "asc" }, { isPinned: "desc" }, { position: "asc" }],
      include: taskCardInclude,
    }),
  ]);

  return {
    items: rows.map((row) => publicTask(row, access.workspaceCtx.member.id)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function listCalendarTasks(
  userId: string,
  query: CalendarTasksQuery,
) {
  await getWorkspaceMembership(userId, query.workspaceId);

  const rangeStart = query.rangeStart;
  const rangeEnd = query.rangeEnd;
  if (rangeEnd < rangeStart) {
    throw new AppError(
      "rangeEnd must be greater than or equal to rangeStart",
      400,
      "VALIDATION_ERROR",
    );
  }

  if (query.projectId) {
    const project = await prisma.project.findFirst({
      where: { id: query.projectId, deletedAt: null },
      select: { workspaceId: true },
    });
    if (!project) {
      throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
    }
    if (project.workspaceId !== query.workspaceId) {
      throw new AppError("Project does not belong to workspace", 400, "BAD_REQUEST");
    }
    await assertTaskAccess(userId, query.projectId);
  }

  if (query.boardId) {
    const board = await prisma.board.findFirst({
      where: { id: query.boardId, deletedAt: null },
      select: { projectId: true, project: { select: { workspaceId: true } } },
    });
    if (!board) {
      throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
    }
    if (board.project.workspaceId !== query.workspaceId) {
      throw new AppError("Board does not belong to workspace", 400, "BAD_REQUEST");
    }
    await assertTaskAccess(userId, board.projectId);
  }

  const assigneeMember = query.assigneeUserId
    ? await prisma.workspaceMember.findFirst({
        where: {
          workspaceId: query.workspaceId,
          userId: query.assigneeUserId,
        },
        select: { id: true },
      })
    : null;

  if (query.assigneeUserId && !assigneeMember) {
    throw new AppError("Assignee is not in workspace", 400, "VALIDATION_ERROR");
  }

  const rows = await prisma.task.findMany({
    where: {
      workspaceId: query.workspaceId,
      deletedAt: null,
      dueDate: {
        gte: rangeStart,
        lte: rangeEnd,
      },
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.boardId ? { boardId: query.boardId } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(assigneeMember
        ? {
            assignments: {
              some: { workspaceMemberId: assigneeMember.id },
            },
          }
        : {}),
    },
    include: taskCardInclude,
    orderBy: [{ dueDate: "asc" }, { isPinned: "desc" }, { position: "asc" }],
  });

  return {
    items: rows.map((row) => publicTask(row)),
    rangeStart: rangeStart.toISOString(),
    rangeEnd: rangeEnd.toISOString(),
  };
}

export async function getTask(userId: string, taskId: string) {
  const task = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, task.projectId);
  return publicTask(task, access.workspaceCtx.member.id);
}

export async function updateTask(
  userId: string,
  taskId: string,
  input: UpdateTaskInput,
) {
  const existing = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, existing.projectId, "task:update");

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

  if (nextStatus && nextStatus !== existing.status) {
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    });
    const actorName = actor?.fullName ?? "Someone";
    if (nextStatus === TaskStatus.DONE) {
      await notifyTaskWatchers({
        taskId,
        workspaceId: existing.workspaceId,
        actorId: userId,
        entityId: taskId,
        notificationType: NotificationType.TASK_COMPLETED,
        title: "Task completed",
        message: `${actorName} marked “${existing.title}” as done.`,
        metadata: { taskId, boardId: existing.boardId },
      });
    } else if (existing.status === TaskStatus.DONE) {
      await notifyTaskWatchers({
        taskId,
        workspaceId: existing.workspaceId,
        actorId: userId,
        entityId: taskId,
        notificationType: NotificationType.SYSTEM,
        title: "Task reopened",
        message: `${actorName} reopened “${existing.title}”.`,
        metadata: { taskId, boardId: existing.boardId },
      });
    }
  }

  return publicTask(updated, access.workspaceCtx.member.id);
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

  return {
    message: "Task deleted successfully",
    taskId: existing.id,
    boardId: existing.boardId,
    workspaceId: existing.workspaceId,
  };
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

export async function watchTask(userId: string, taskId: string) {
  const task = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, task.projectId, "task:update");
  const workspaceMemberId = access.workspaceCtx.member.id;

  await prisma.taskWatcher.upsert({
    where: { taskId_workspaceMemberId: { taskId, workspaceMemberId } },
    create: { taskId, workspaceMemberId },
    update: {},
  });

  await prisma.activity.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATE,
      afterData: { watch: true },
    },
  });

  return getTask(userId, taskId);
}

export async function unwatchTask(userId: string, taskId: string) {
  const task = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, task.projectId, "task:update");
  const workspaceMemberId = access.workspaceCtx.member.id;

  await prisma.taskWatcher.deleteMany({
    where: {
      taskId,
      workspaceMemberId,
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATE,
      afterData: { watch: false },
    },
  });

  return getTask(userId, taskId);
}

export async function pinTask(userId: string, taskId: string, pinned: boolean) {
  const task = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, task.projectId, "task:update");
  const updated = await prisma.task.update({
    where: { id: taskId },
    data: {
      isPinned: pinned,
      updatedBy: userId,
    },
    include: taskCardInclude,
  });

  await prisma.activity.create({
    data: {
      workspaceId: task.workspaceId,
      projectId: task.projectId,
      actorId: userId,
      entityType: ActivityEntityType.TASK,
      entityId: taskId,
      action: ActivityAction.UPDATE,
      beforeData: { isPinned: task.isPinned },
      afterData: { isPinned: pinned },
    },
  });

  return publicTask(updated, access.workspaceCtx.member.id);
}

export async function duplicateTask(
  userId: string,
  taskId: string,
  destinationColumnId?: string,
) {
  const sourceTask = await getTaskOrThrow(taskId);
  const access = await assertTaskAccess(userId, sourceTask.projectId, "task:create");
  const targetColumnId = destinationColumnId ?? sourceTask.columnId;

  if (destinationColumnId) {
    const targetColumn = await getColumnContext(destinationColumnId);
    if (targetColumn.boardId !== sourceTask.boardId) {
      throw new AppError(
        "Destination column must belong to the same board",
        400,
        "INVALID_MOVE",
      );
    }
  }

  const [sourceChecklists, maxPos, code] = await Promise.all([
    prisma.checklist.findMany({
      where: { taskId, deletedAt: null },
      orderBy: { position: "asc" },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
        },
      },
    }),
    prisma.task.aggregate({
      where: { columnId: targetColumnId, deletedAt: null },
      _max: { position: true },
    }),
    nextTaskCode(sourceTask.projectId),
  ]);

  const duplicated = await prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        workspaceId: sourceTask.workspaceId,
        projectId: sourceTask.projectId,
        boardId: sourceTask.boardId,
        columnId: targetColumnId,
        createdBy: userId,
        updatedBy: userId,
        code,
        title: `${sourceTask.title} (Copy)`,
        description: sourceTask.description,
        priority: sourceTask.priority,
        status: sourceTask.status,
        startDate: sourceTask.startDate,
        dueDate: sourceTask.dueDate,
        completedAt: sourceTask.completedAt,
        estimatedHours: sourceTask.estimatedHours,
        actualHours: sourceTask.actualHours,
        coverImage: sourceTask.coverImage,
        position: (maxPos._max.position ?? -1) + 1,
        isPinned: false,
        assignments: sourceTask.assignments.length
          ? {
              create: sourceTask.assignments.map((a) => ({
                workspaceMemberId: a.workspaceMemberId,
                assignedBy: userId,
              })),
            }
          : undefined,
        labels: sourceTask.labels.length
          ? {
              create: sourceTask.labels.map((l) => ({
                labelId: l.labelId,
              })),
            }
          : undefined,
      },
      include: taskCardInclude,
    });

    for (const checklist of sourceChecklists) {
      const createdChecklist = await tx.checklist.create({
        data: {
          taskId: created.id,
          title: checklist.title,
          position: checklist.position,
          createdBy: userId,
        },
      });
      if (checklist.items.length) {
        await tx.checklistItem.createMany({
          data: checklist.items.map((item) => ({
            checklistId: createdChecklist.id,
            title: item.title,
            isCompleted: false,
            position: item.position,
          })),
        });
      }
    }

    await tx.taskPosition.create({
      data: {
        taskId: created.id,
        columnId: targetColumnId,
        position: created.position,
        movedBy: userId,
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: sourceTask.workspaceId,
        projectId: sourceTask.projectId,
        actorId: userId,
        entityType: ActivityEntityType.TASK,
        entityId: created.id,
        action: ActivityAction.CREATE,
        afterData: { title: created.title, code: created.code, duplicatedFrom: taskId },
      },
    });

    return created;
  });

  return publicTask(duplicated, access.workspaceCtx.member.id);
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

function publicLabel(l: {
  id: string;
  name: string;
  color: string;
  description: string | null;
}) {
  return {
    id: l.id,
    name: l.name,
    color: l.color,
    description: l.description,
  };
}

export async function createProjectLabel(
  userId: string,
  input: CreateProjectLabelInput,
) {
  await assertTaskAccess(userId, input.projectId, "task:update");

  const existing = await prisma.projectLabel.findFirst({
    where: {
      projectId: input.projectId,
      name: { equals: input.name, mode: "insensitive" },
    },
  });
  if (existing) {
    throw new AppError(
      "A label with this name already exists in the project",
      409,
      "LABEL_EXISTS",
    );
  }

  const label = await prisma.projectLabel.create({
    data: {
      projectId: input.projectId,
      name: input.name,
      color: input.color,
      description: input.description ?? null,
    },
  });

  let task = null as Awaited<ReturnType<typeof getTask>> | null;
  if (input.taskId) {
    const taskRow = await getTaskOrThrow(input.taskId);
    if (taskRow.projectId !== input.projectId) {
      throw new AppError(
        "Task does not belong to this project",
        400,
        "VALIDATION_ERROR",
      );
    }
    await prisma.taskLabel.upsert({
      where: { taskId_labelId: { taskId: input.taskId, labelId: label.id } },
      create: { taskId: input.taskId, labelId: label.id },
      update: {},
    });
    task = await getTask(userId, input.taskId);
  }

  return { label: publicLabel(label), task };
}

export async function deleteProjectLabel(userId: string, labelId: string) {
  const label = await prisma.projectLabel.findFirst({
    where: { id: labelId },
  });
  if (!label) {
    throw new AppError("Label not found", 404, "LABEL_NOT_FOUND");
  }

  await assertTaskAccess(userId, label.projectId, "task:update");

  await prisma.$transaction([
    prisma.taskLabel.deleteMany({ where: { labelId } }),
    prisma.projectLabel.delete({ where: { id: labelId } }),
  ]);

  return { id: labelId, projectId: label.projectId };
}
