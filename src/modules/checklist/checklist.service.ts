import {
  ActivityAction,
  ActivityEntityType,
  type Prisma,
} from "@prisma/client";
import {
  assertPermission,
  getAccessibleProject,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type {
  CreateChecklistInput,
  CreateChecklistItemInput,
  ReorderChecklistItemsInput,
  UpdateChecklistInput,
  UpdateChecklistItemInput,
} from "./checklist.schema.js";

const itemSelect = {
  id: true,
  checklistId: true,
  title: true,
  isCompleted: true,
  completedBy: true,
  completedAt: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ChecklistItemSelect;

function publicItem(
  item: Prisma.ChecklistItemGetPayload<{ select: typeof itemSelect }>,
) {
  return {
    id: item.id,
    itemId: item.id,
    checklistId: item.checklistId,
    title: item.title,
    completed: item.isCompleted,
    isCompleted: item.isCompleted,
    completedBy: item.completedBy,
    completedAt: item.completedAt,
    position: item.position,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function progressFromItems(items: { isCompleted: boolean }[]) {
  const total = items.length;
  const completed = items.filter((i) => i.isCompleted).length;
  return {
    completed,
    total,
    progress: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

function publicChecklist(
  checklist: {
    id: string;
    taskId: string;
    title: string;
    position: number;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    items: Prisma.ChecklistItemGetPayload<{ select: typeof itemSelect }>[];
  },
) {
  const items = checklist.items.map(publicItem);
  return {
    id: checklist.id,
    checklistId: checklist.id,
    taskId: checklist.taskId,
    title: checklist.title,
    position: checklist.position,
    createdBy: checklist.createdBy,
    createdAt: checklist.createdAt,
    updatedAt: checklist.updatedAt,
    items,
    ...progressFromItems(checklist.items),
  };
}

async function getTaskOrThrow(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
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

async function getChecklistOrThrow(checklistId: string) {
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, deletedAt: null },
    include: {
      task: true,
      items: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: itemSelect,
      },
    },
  });
  if (!checklist || checklist.task.deletedAt) {
    throw new AppError("Checklist not found", 404, "CHECKLIST_NOT_FOUND");
  }
  return checklist;
}

async function getItemOrThrow(itemId: string) {
  const item = await prisma.checklistItem.findFirst({
    where: { id: itemId, deletedAt: null },
    include: {
      checklist: {
        include: { task: true },
      },
    },
  });
  if (
    !item ||
    item.checklist.deletedAt ||
    item.checklist.task.deletedAt
  ) {
    throw new AppError("Checklist item not found", 404, "CHECKLIST_ITEM_NOT_FOUND");
  }
  return item;
}

export async function createChecklist(
  userId: string,
  input: CreateChecklistInput,
) {
  const task = await getTaskOrThrow(input.taskId);
  await assertTaskAccess(userId, task.projectId, "task:update");

  const maxPos = await prisma.checklist.aggregate({
    where: { taskId: task.id, deletedAt: null },
    _max: { position: true },
  });

  const created = await prisma.$transaction(async (tx) => {
    const checklist = await tx.checklist.create({
      data: {
        taskId: task.id,
        title: input.title,
        position: (maxPos._max.position ?? -1) + 1,
        createdBy: userId,
      },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: itemSelect,
        },
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST,
        entityId: checklist.id,
        action: ActivityAction.CREATE,
        afterData: { title: checklist.title, taskId: task.id },
      },
    });

    return checklist;
  });

  return publicChecklist(created);
}

export async function listChecklists(userId: string, taskId: string) {
  const task = await getTaskOrThrow(taskId);
  await assertTaskAccess(userId, task.projectId);

  const rows = await prisma.checklist.findMany({
    where: { taskId, deletedAt: null },
    orderBy: { position: "asc" },
    include: {
      items: {
        where: { deletedAt: null },
        orderBy: { position: "asc" },
        select: itemSelect,
      },
    },
  });

  return { items: rows.map(publicChecklist) };
}

export async function updateChecklist(
  userId: string,
  checklistId: string,
  input: UpdateChecklistInput,
) {
  const checklist = await getChecklistOrThrow(checklistId);
  await assertTaskAccess(userId, checklist.task.projectId, "task:update");

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.checklist.update({
      where: { id: checklistId },
      data: { title: input.title },
      include: {
        items: {
          where: { deletedAt: null },
          orderBy: { position: "asc" },
          select: itemSelect,
        },
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: checklist.task.workspaceId,
        projectId: checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST,
        entityId: checklistId,
        action: ActivityAction.UPDATE,
        beforeData: { title: checklist.title },
        afterData: { title: input.title },
      },
    });

    return row;
  });

  return publicChecklist(updated);
}

export async function deleteChecklist(userId: string, checklistId: string) {
  const checklist = await getChecklistOrThrow(checklistId);
  await assertTaskAccess(userId, checklist.task.projectId, "task:update");

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.updateMany({
      where: { checklistId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.checklist.update({
      where: { id: checklistId },
      data: { deletedAt: now },
    });
    await tx.activity.create({
      data: {
        workspaceId: checklist.task.workspaceId,
        projectId: checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST,
        entityId: checklistId,
        action: ActivityAction.DELETE,
        beforeData: { title: checklist.title },
      },
    });
  });

  return { message: "Checklist deleted" };
}

export async function createChecklistItem(
  userId: string,
  checklistId: string,
  input: CreateChecklistItemInput,
) {
  const checklist = await getChecklistOrThrow(checklistId);
  await assertTaskAccess(userId, checklist.task.projectId, "task:update");

  const maxPos = await prisma.checklistItem.aggregate({
    where: { checklistId, deletedAt: null },
    _max: { position: true },
  });

  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.checklistItem.create({
      data: {
        checklistId,
        title: input.title,
        position: (maxPos._max.position ?? -1) + 1,
      },
      select: itemSelect,
    });

    await tx.activity.create({
      data: {
        workspaceId: checklist.task.workspaceId,
        projectId: checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST_ITEM,
        entityId: created.id,
        action: ActivityAction.CREATE,
        afterData: { title: created.title, checklistId },
      },
    });

    return created;
  });

  return publicItem(item);
}

export async function updateChecklistItem(
  userId: string,
  itemId: string,
  input: UpdateChecklistItemInput,
) {
  const item = await getItemOrThrow(itemId);
  await assertTaskAccess(userId, item.checklist.task.projectId, "task:update");

  const data: Prisma.ChecklistItemUncheckedUpdateInput = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.completed !== undefined) {
    data.isCompleted = input.completed;
    if (input.completed) {
      data.completedBy = userId;
      data.completedAt = new Date();
    } else {
      data.completedBy = null;
      data.completedAt = null;
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.checklistItem.update({
      where: { id: itemId },
      data,
      select: itemSelect,
    });

    await tx.activity.create({
      data: {
        workspaceId: item.checklist.task.workspaceId,
        projectId: item.checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST_ITEM,
        entityId: itemId,
        action:
          input.completed === true
            ? ActivityAction.COMPLETE
            : input.completed === false
              ? ActivityAction.REOPEN
              : ActivityAction.UPDATE,
        beforeData: {
          title: item.title,
          isCompleted: item.isCompleted,
        },
        afterData: {
          title: row.title,
          isCompleted: row.isCompleted,
        },
      },
    });

    return row;
  });

  return publicItem(updated);
}

export async function completeChecklistItem(
  userId: string,
  itemId: string,
  completed: boolean,
) {
  return updateChecklistItem(userId, itemId, { completed });
}

export async function deleteChecklistItem(userId: string, itemId: string) {
  const item = await getItemOrThrow(itemId);
  await assertTaskAccess(userId, item.checklist.task.projectId, "task:update");

  await prisma.$transaction(async (tx) => {
    await tx.checklistItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date() },
    });
    await tx.activity.create({
      data: {
        workspaceId: item.checklist.task.workspaceId,
        projectId: item.checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST_ITEM,
        entityId: itemId,
        action: ActivityAction.DELETE,
        beforeData: { title: item.title },
      },
    });
  });

  return { message: "Checklist item deleted" };
}

export async function reorderChecklistItems(
  userId: string,
  checklistId: string,
  input: ReorderChecklistItemsInput,
) {
  const checklist = await getChecklistOrThrow(checklistId);
  await assertTaskAccess(userId, checklist.task.projectId, "task:update");

  const existingIds = new Set(checklist.items.map((i) => i.id));
  for (const row of input.items) {
    if (!existingIds.has(row.id)) {
      throw new AppError(
        "One or more items do not belong to this checklist",
        400,
        "VALIDATION_ERROR",
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const row of input.items) {
      await tx.checklistItem.update({
        where: { id: row.id },
        data: { position: row.position },
      });
    }
    await tx.activity.create({
      data: {
        workspaceId: checklist.task.workspaceId,
        projectId: checklist.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.CHECKLIST,
        entityId: checklistId,
        action: ActivityAction.MOVE,
        afterData: { items: input.items },
      },
    });
  });

  const refreshed = await getChecklistOrThrow(checklistId);
  return publicChecklist(refreshed);
}

export async function getChecklistProgress(
  userId: string,
  checklistId: string,
) {
  const checklist = await getChecklistOrThrow(checklistId);
  await assertTaskAccess(userId, checklist.task.projectId);
  return {
    checklistId,
    ...progressFromItems(checklist.items),
  };
}
