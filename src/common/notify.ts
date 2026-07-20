import {
  NotificationEntityType,
  NotificationType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../database/prisma.js";

export type NotifyInput = {
  workspaceId: string;
  recipientId: string;
  senderId?: string | null;
  entityType: NotificationEntityType;
  entityId: string;
  notificationType: NotificationType;
  title: string;
  message: string;
  metadata?: Prisma.InputJsonValue;
};

function settingAllows(
  settings: {
    inAppEnabled: boolean;
    assignmentEnabled: boolean;
    mentionEnabled: boolean;
    commentEnabled: boolean;
    dueDateEnabled: boolean;
  } | null,
  type: NotificationType,
) {
  if (!settings) return true;
  if (!settings.inAppEnabled) return false;

  switch (type) {
    case NotificationType.TASK_ASSIGNED:
    case NotificationType.TASK_UNASSIGNED:
      return settings.assignmentEnabled;
    case NotificationType.USER_MENTIONED:
      return settings.mentionEnabled;
    case NotificationType.COMMENT_ADDED:
    case NotificationType.COMMENT_REPLY:
      return settings.commentEnabled;
    case NotificationType.TASK_DUE_SOON:
    case NotificationType.TASK_OVERDUE:
      return settings.dueDateEnabled;
    default:
      return true;
  }
}

/** Create an in-app notification if recipient settings allow it. */
export async function notifyUser(input: NotifyInput) {
  if (input.senderId && input.senderId === input.recipientId) {
    return null;
  }

  const settings = await prisma.notificationSetting.findUnique({
    where: { userId: input.recipientId },
  });

  if (!settingAllows(settings, input.notificationType)) {
    return null;
  }

  return prisma.notification.create({
    data: {
      workspaceId: input.workspaceId,
      recipientId: input.recipientId,
      senderId: input.senderId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      notificationType: input.notificationType,
      title: input.title,
      message: input.message,
      metadata: input.metadata ?? undefined,
    },
  });
}

export async function notifyMany(
  inputs: NotifyInput[],
): Promise<number> {
  let created = 0;
  for (const input of inputs) {
    const row = await notifyUser(input);
    if (row) created += 1;
  }
  return created;
}
