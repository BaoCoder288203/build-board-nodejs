import {
  ActivityAction,
  ActivityEntityType,
  type Prisma,
} from "@prisma/client";
import { getWorkspaceMembership } from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type {
  ListActivitiesQuery,
  SearchActivitiesQuery,
  TimelineQuery,
} from "./activity.schema.js";

const actorSelect = {
  id: true,
  fullName: true,
  email: true,
  username: true,
  avatarUrl: true,
} as const;

function publicActivity(row: {
  id: string;
  workspaceId: string;
  projectId: string | null;
  actorId: string;
  entityType: ActivityEntityType;
  entityId: string;
  action: ActivityAction;
  beforeData: Prisma.JsonValue | null;
  afterData: Prisma.JsonValue | null;
  metadata: Prisma.JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  actor?: {
    id: string;
    fullName: string;
    email: string;
    username: string;
    avatarUrl: string | null;
  };
}) {
  const type = `${row.entityType}_${row.action}`;
  return {
    id: row.id,
    activityId: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    actorId: row.actorId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    type,
    beforeData: row.beforeData,
    afterData: row.afterData,
    metadata: row.metadata,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt,
    actor: row.actor
      ? {
          id: row.actor.id,
          fullName: row.actor.fullName,
          email: row.actor.email,
          username: row.actor.username,
          avatar: row.actor.avatarUrl,
        }
      : null,
  };
}

async function taskRelatedWhere(
  taskId: string,
): Promise<Prisma.ActivityWhereInput> {
  const [checklists, comments, attachments] = await Promise.all([
    prisma.checklist.findMany({
      where: { taskId, deletedAt: null },
      select: {
        id: true,
        items: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
    prisma.comment.findMany({
      where: { taskId, deletedAt: null },
      select: { id: true },
    }),
    prisma.attachment.findMany({
      where: { taskId, deletedAt: null },
      select: { id: true },
    }),
  ]);

  const checklistIds = checklists.map((c) => c.id);
  const itemIds = checklists.flatMap((c) => c.items.map((i) => i.id));
  const commentIds = comments.map((c) => c.id);
  const attachmentIds = attachments.map((a) => a.id);

  const ors: Prisma.ActivityWhereInput[] = [
    { entityType: ActivityEntityType.TASK, entityId: taskId },
    {
      afterData: {
        path: ["taskId"],
        equals: taskId,
      },
    },
  ];

  if (checklistIds.length) {
    ors.push({
      entityType: ActivityEntityType.CHECKLIST,
      entityId: { in: checklistIds },
    });
  }
  if (itemIds.length) {
    ors.push({
      entityType: ActivityEntityType.CHECKLIST_ITEM,
      entityId: { in: itemIds },
    });
  }
  if (commentIds.length) {
    ors.push({
      entityType: ActivityEntityType.COMMENT,
      entityId: { in: commentIds },
    });
  }
  if (attachmentIds.length) {
    ors.push({
      entityType: ActivityEntityType.ATTACHMENT,
      entityId: { in: attachmentIds },
    });
  }

  return { OR: ors };
}

async function boardRelatedWhere(
  boardId: string,
): Promise<Prisma.ActivityWhereInput> {
  const [tasks, columns] = await Promise.all([
    prisma.task.findMany({
      where: { boardId, deletedAt: null },
      select: { id: true },
    }),
    prisma.column.findMany({
      where: { boardId },
      select: { id: true },
    }),
  ]);
  const taskIds = tasks.map((t) => t.id);
  const columnIds = columns.map((c) => c.id);

  const ors: Prisma.ActivityWhereInput[] = [
    { entityType: ActivityEntityType.BOARD, entityId: boardId },
  ];
  if (columnIds.length) {
    ors.push({
      entityType: ActivityEntityType.COLUMN,
      entityId: { in: columnIds },
    });
  }
  if (taskIds.length) {
    ors.push({
      entityType: ActivityEntityType.TASK,
      entityId: { in: taskIds },
    });
  }
  return { OR: ors };
}

async function buildListWhere(
  query: ListActivitiesQuery,
): Promise<Prisma.ActivityWhereInput> {
  const where: Prisma.ActivityWhereInput = {
    workspaceId: query.workspaceId,
  };

  if (query.projectId) where.projectId = query.projectId;
  if (query.userId) where.actorId = query.userId;
  if (query.entityType) where.entityType = query.entityType;
  if (query.action) where.action = query.action;

  if (query.taskId) {
    Object.assign(where, await taskRelatedWhere(query.taskId));
  } else if (query.boardId) {
    Object.assign(where, await boardRelatedWhere(query.boardId));
  }

  return where;
}

export async function listActivities(
  userId: string,
  query: ListActivitiesQuery,
) {
  await getWorkspaceMembership(userId, query.workspaceId);
  const where = await buildListWhere(query);
  const skip = (query.page - 1) * query.limit;

  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: actorSelect } },
    }),
  ]);

  return {
    items: rows.map(publicActivity),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function getTimeline(userId: string, query: TimelineQuery) {
  await getWorkspaceMembership(userId, query.workspaceId);
  const where: Prisma.ActivityWhereInput = {
    workspaceId: query.workspaceId,
  };
  const skip = (query.page - 1) * query.limit;

  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: actorSelect } },
    }),
  ]);

  return {
    items: rows.map(publicActivity),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function searchActivities(
  userId: string,
  query: SearchActivitiesQuery,
) {
  await getWorkspaceMembership(userId, query.workspaceId);

  const where: Prisma.ActivityWhereInput = {
    workspaceId: query.workspaceId,
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
  };

  if (query.keyword) {
    const keyword = query.keyword;
    where.OR = [
      {
        actor: {
          OR: [
            { fullName: { contains: keyword, mode: "insensitive" } },
            { email: { contains: keyword, mode: "insensitive" } },
            { username: { contains: keyword, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const [total, rows] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: actorSelect } },
    }),
  ]);

  return {
    items: rows.map(publicActivity),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function getActivity(userId: string, activityId: string) {
  const row = await prisma.activity.findUnique({
    where: { id: activityId },
    include: { actor: { select: actorSelect } },
  });
  if (!row) {
    throw new AppError("Activity not found", 404, "ACTIVITY_NOT_FOUND");
  }
  await getWorkspaceMembership(userId, row.workspaceId);
  return publicActivity(row);
}

/** Best-effort auth audit: one row on the user's first workspace. */
export async function logAuthActivity(input: {
  userId: string;
  action: typeof ActivityAction.LOGIN | typeof ActivityAction.LOGOUT;
  ip?: string;
  userAgent?: string;
}) {
  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: input.userId },
    orderBy: { joinedAt: "asc" },
    select: { workspaceId: true },
  });
  if (!membership) return;

  await prisma.activity.create({
    data: {
      workspaceId: membership.workspaceId,
      actorId: input.userId,
      entityType: ActivityEntityType.USER,
      entityId: input.userId,
      action: input.action,
      ipAddress: input.ip?.slice(0, 100) ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { source: "auth" },
    },
  });
}
