import type { Prisma } from "@prisma/client";
import { SERVER_EVENT, userRoom, type NotificationRealtimeItem } from "./events.js";
import { getRealtimeNamespace } from "./socket.js";

function toRealtimeNotification(row: {
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
}): NotificationRealtimeItem {
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
    readAt: row.readAt ? row.readAt.toISOString() : null,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
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

export function emitNotificationNew(row: {
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
  const rt = getRealtimeNamespace();
  if (!rt) return;
  rt.to(userRoom(row.recipientId)).emit(SERVER_EVENT.NOTIFICATION_NEW, {
    notification: toRealtimeNotification(row),
    occurredAt: new Date().toISOString(),
  });
}
