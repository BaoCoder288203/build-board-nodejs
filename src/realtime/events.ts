import { z } from "zod";

export const RT_NAMESPACE = "/rt";

export const CLIENT_EVENT = {
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  TYPING_STATE: "typing:state",
} as const;

export const SERVER_EVENT = {
  ROOM_JOINED: "room:joined",
  ROOM_LEFT: "room:left",
  ROOM_PRESENCE: "room:presence",
  TYPING_STATE: "typing:state",
  SOCKET_ERROR: "socket:error",
  BOARD_CHANGED: "board:changed",
  WORKSPACE_CHANGED: "workspace:changed",
  TASK_CREATED: "task:created",
  TASK_DELETED: "task:deleted",
  TASK_MOVED: "task:moved",
  TASK_UPDATED: "task:updated",
  COMMENT_CREATED: "comment:created",
  COMMENT_UPDATED: "comment:updated",
  COMMENT_DELETED: "comment:deleted",
  COMMENT_REACTION: "comment:reaction",
  NOTIFICATION_NEW: "notification:new",
} as const;

export const roomKindSchema = z.enum(["workspace", "board", "task"]);

export const roomKeySchema = z
  .string()
  .regex(/^(workspace|board|task):[0-9a-fA-F-]{36}$/);

export const roomJoinSchema = z.object({
  room: roomKeySchema,
});

export const roomLeaveSchema = z.object({
  room: roomKeySchema,
});

export const typingStateSchema = z.object({
  room: roomKeySchema,
  taskId: z.string().uuid(),
  isTyping: z.boolean(),
});

export type RoomKey = z.infer<typeof roomKeySchema>;

export type RealtimeSocketErrorCode =
  | "BAD_PAYLOAD"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "INTERNAL";

export type RealtimeSocketErrorPayload = {
  code: RealtimeSocketErrorCode;
  message: string;
  event?: string;
};

export type RoomPresencePayload = {
  room: RoomKey;
  users: Array<{
    id: string;
    fullName: string;
    avatar: string | null;
  }>;
  occurredAt: string;
};

export type TypingStatePayload = {
  room: RoomKey;
  taskId: string;
  isTyping: boolean;
  user: {
    id: string;
    fullName: string;
  };
  occurredAt: string;
};

export type TaskMovedPayload = {
  taskId: string;
  boardId: string;
  workspaceId: string;
  sourceColumnId: string;
  destinationColumnId: string;
  newPosition: number;
  movedBy: string;
  occurredAt: string;
};

export type TaskUpdatedPayload = {
  task: {
    id: string;
    taskId?: string;
    boardId: string;
    workspaceId: string;
    columnId: string;
    position: number;
    [key: string]: unknown;
  };
  updatedBy: string;
  occurredAt: string;
};

export type TaskCreatedPayload = TaskUpdatedPayload;

export type TaskDeletedPayload = {
  taskId: string;
  boardId: string;
  workspaceId: string;
  deletedBy: string;
  occurredAt: string;
};

export type BoardChangedPayload = {
  boardId: string;
  workspaceId: string;
  reason:
    | "column_created"
    | "column_updated"
    | "column_reordered"
    | "column_deleted"
    | "column_copied"
    | "column_moved"
    | "column_tasks_moved"
    | "column_sorted"
    | "column_archived"
    | "column_restored"
    | "board_updated"
    | "board_archived"
    | "board_restored"
    | "board_deleted";
  actorId: string;
  occurredAt: string;
};

export type WorkspaceChangedPayload = {
  workspaceId: string;
  reason:
    | "project_created"
    | "project_updated"
    | "project_archived"
    | "project_restored"
    | "project_deleted"
    | "board_created"
    | "board_updated"
    | "board_archived"
    | "board_restored"
    | "board_deleted";
  actorId: string;
  projectId?: string;
  boardId?: string;
  occurredAt: string;
};

export type CommentRealtimePayload = {
  boardId: string;
  workspaceId: string;
  taskId: string;
  comment: Record<string, unknown> & {
    id: string;
    taskId: string;
    parentCommentId?: string | null;
  };
  actorId: string;
  occurredAt: string;
};

export type CommentDeletedPayload = {
  boardId: string;
  workspaceId: string;
  taskId: string;
  commentId: string;
  parentCommentId?: string | null;
  actorId: string;
  occurredAt: string;
};

export type NotificationRealtimeItem = {
  id: string;
  notificationId: string;
  workspaceId: string;
  recipientId: string;
  senderId: string | null;
  entityType: string;
  entityId: string;
  notificationType: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  metadata: unknown;
  createdAt: string;
  sender: {
    id: string;
    fullName: string;
    email: string;
    avatar: string | null;
  } | null;
};

export type NotificationNewPayload = {
  notification: NotificationRealtimeItem;
  occurredAt: string;
};

export function userRoom(userId: string) {
  return `user:${userId}`;
}
