import { NotificationType, type Prisma } from "@prisma/client";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type {
  ListNotificationsQuery,
  UpdateNotificationSettingsInput,
} from "./notification.schema.js";

function publicNotification(row: {
  id: string;
  workspaceId: string;
  recipientId: string;
  senderId: string | null;
  entityType: string;
  entityId: string;
  notificationType: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: Date | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  sender?: {
    id: string;
    fullName: string;
    email: string;
    avatarUrl: string | null;
  } | null;
}) {
  return {
    id: row.id,
    notificationId: row.id,
    workspaceId: row.workspaceId,
    recipientId: row.recipientId,
    senderId: row.senderId,
    entityType: row.entityType,
    entityId: row.entityId,
    notificationType: row.notificationType,
    title: row.title,
    message: row.message,
    isRead: row.isRead,
    readAt: row.readAt,
    metadata: row.metadata,
    createdAt: row.createdAt,
    sender: row.sender
      ? {
          id: row.sender.id,
          fullName: row.sender.fullName,
          email: row.sender.email,
          avatar: row.sender.avatarUrl,
        }
      : null,
  };
}

export async function listNotifications(
  userId: string,
  query: ListNotificationsQuery,
) {
  const typeFilter =
    query.type &&
    (Object.values(NotificationType) as string[]).includes(query.type)
      ? (query.type as NotificationType)
      : undefined;

  const where: Prisma.NotificationWhereInput = {
    recipientId: userId,
    deletedAt: null,
    ...(query.isRead === undefined ? {} : { isRead: query.isRead }),
    ...(typeFilter ? { notificationType: typeFilter } : {}),
  };

  const skip = (query.page - 1) * query.limit;
  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({
      where: { recipientId: userId, deletedAt: null, isRead: false },
    }),
    prisma.notification.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: "desc" },
      include: {
        sender: {
          select: {
            id: true,
            fullName: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map(publicNotification),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
    unreadCount,
  };
}

export async function unreadCount(userId: string) {
  const count = await prisma.notification.count({
    where: { recipientId: userId, deletedAt: null, isRead: false },
  });
  return { unreadCount: count };
}

export async function markAsRead(userId: string, notificationId: string) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId, deletedAt: null },
  });
  if (!row) {
    throw new AppError("Notification not found", 404, "NOTIFICATION_NOT_FOUND");
  }

  if (row.isRead) {
    return publicNotification(row);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { isRead: true, readAt: new Date() },
    include: {
      sender: {
        select: {
          id: true,
          fullName: true,
          email: true,
          avatarUrl: true,
        },
      },
    },
  });

  return publicNotification(updated);
}

export async function markAllAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { recipientId: userId, deletedAt: null, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

export async function deleteNotification(userId: string, notificationId: string) {
  const row = await prisma.notification.findFirst({
    where: { id: notificationId, recipientId: userId, deletedAt: null },
  });
  if (!row) {
    throw new AppError("Notification not found", 404, "NOTIFICATION_NOT_FOUND");
  }

  await prisma.notification.update({
    where: { id: notificationId },
    data: { deletedAt: new Date() },
  });

  return { message: "Notification deleted" };
}

async function ensureSettings(userId: string) {
  return prisma.notificationSetting.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getSettings(userId: string) {
  const settings = await ensureSettings(userId);
  return {
    emailEnabled: settings.emailEnabled,
    pushEnabled: settings.pushEnabled,
    inAppEnabled: settings.inAppEnabled,
    dueDateEnabled: settings.dueDateEnabled,
    mentionEnabled: settings.mentionEnabled,
    assignmentEnabled: settings.assignmentEnabled,
    commentEnabled: settings.commentEnabled,
  };
}

export async function updateSettings(
  userId: string,
  input: UpdateNotificationSettingsInput,
) {
  await ensureSettings(userId);
  const settings = await prisma.notificationSetting.update({
    where: { userId },
    data: input,
  });
  return {
    emailEnabled: settings.emailEnabled,
    pushEnabled: settings.pushEnabled,
    inAppEnabled: settings.inAppEnabled,
    dueDateEnabled: settings.dueDateEnabled,
    mentionEnabled: settings.mentionEnabled,
    assignmentEnabled: settings.assignmentEnabled,
    commentEnabled: settings.commentEnabled,
  };
}
