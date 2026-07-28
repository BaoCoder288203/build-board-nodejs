import type { Server as HttpServer } from "node:http";
import {
  Server as SocketIOServer,
  type Namespace,
  type Socket,
} from "socket.io";
import { AppError } from "../common/app-error.js";
import { env } from "../config/env.js";
import { authenticateSocket } from "./auth.js";
import {
  CLIENT_EVENT,
  RT_NAMESPACE,
  SERVER_EVENT,
  roomJoinSchema,
  roomLeaveSchema,
  typingStateSchema,
  type RoomKey,
  type RealtimeSocketErrorPayload,
} from "./events.js";
import { rtLog } from "./logger.js";
import {
  getRealtimeMetrics,
  recordAuthFailure,
  recordConnectionClose,
  recordConnectionOpen,
  recordRateLimited,
  recordRoomJoin,
  recordRoomLeave,
  recordSocketError,
  recordTypingEvent,
} from "./metrics.js";
import { assertRoomAccess } from "./rooms.js";

const MAX_ROOM_ACTIONS_PER_MINUTE = 120;
const MAX_TYPING_EVENTS_PER_MINUTE = 60;
const MAX_ROOMS_PER_SOCKET = 24;
const METRICS_LOG_INTERVAL_MS = 60_000;

let rtNamespace: Namespace | null = null;
let metricsTimer: ReturnType<typeof setInterval> | null = null;

const roomPresenceIndex = new Map<
  string,
  Map<string, { id: string; fullName: string; avatar: string | null }>
>();

function upsertPresence(room: string, socket: Socket) {
  const current = roomPresenceIndex.get(room) ?? new Map();
  current.set(socket.id, {
    id: socket.data.user.id,
    fullName: socket.data.user.fullName,
    avatar: socket.data.user.avatar ?? null,
  });
  roomPresenceIndex.set(room, current);
}

function removePresence(room: string, socketId: string) {
  const current = roomPresenceIndex.get(room);
  if (!current) return;
  current.delete(socketId);
  if (current.size === 0) {
    roomPresenceIndex.delete(room);
  }
}

function emitRoomPresence(room: string) {
  const rt = getRealtimeNamespace();
  if (!rt) return;
  const current = roomPresenceIndex.get(room);
  const users = current
    ? [...new Map([...current.values()].map((u) => [u.id, u])).values()]
    : [];
  rt.to(room).emit(SERVER_EVENT.ROOM_PRESENCE, {
    room,
    users,
    occurredAt: new Date().toISOString(),
  });
}

function emitSocketError(
  socket: Socket,
  payload: RealtimeSocketErrorPayload,
): void {
  recordSocketError();
  socket.emit(SERVER_EVENT.SOCKET_ERROR, payload);
}

function handleError(socket: Socket, error: unknown, event?: string): void {
  if (error instanceof AppError) {
    emitSocketError(socket, {
      code: (error.code as RealtimeSocketErrorPayload["code"]) ?? "INTERNAL",
      message: error.message,
      event,
    });
    return;
  }

  emitSocketError(socket, {
    code: "INTERNAL",
    message: "Unexpected realtime error",
    event,
  });
}

function createRateLimiter(limit: number) {
  let count = 0;
  let windowStartedAt = Date.now();

  return () => {
    const now = Date.now();
    if (now - windowStartedAt > 60_000) {
      count = 0;
      windowStartedAt = now;
    }
    count += 1;
    if (count > limit) {
      recordRateLimited();
      return false;
    }
    return true;
  };
}

function attachRealtimeHandlers(socket: Socket) {
  const canProcessRoomAction = createRateLimiter(MAX_ROOM_ACTIONS_PER_MINUTE);
  const canProcessTyping = createRateLimiter(MAX_TYPING_EVENTS_PER_MINUTE);

  socket.on(CLIENT_EVENT.ROOM_JOIN, async (payload: unknown) => {
    if (!canProcessRoomAction()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Room action rate limit exceeded",
        event: CLIENT_EVENT.ROOM_JOIN,
      });
      return;
    }

    const parsed = roomJoinSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid join payload",
        event: CLIENT_EVENT.ROOM_JOIN,
      });
      return;
    }

    try {
      const room = parsed.data.room as RoomKey;
      const joinedRooms = [...socket.rooms].filter((r) => r !== socket.id);
      if (!joinedRooms.includes(room) && joinedRooms.length >= MAX_ROOMS_PER_SOCKET) {
        emitSocketError(socket, {
          code: "FORBIDDEN",
          message: `Max ${MAX_ROOMS_PER_SOCKET} rooms per connection`,
          event: CLIENT_EVENT.ROOM_JOIN,
        });
        return;
      }

      await assertRoomAccess(socket.data.user.id, room);
      await socket.join(room);
      upsertPresence(room, socket);
      recordRoomJoin();
      rtLog.debug("room_join", {
        socketId: socket.id,
        userId: socket.data.user.id,
        room,
      });
      socket.emit(SERVER_EVENT.ROOM_JOINED, {
        room,
        joinedAt: new Date().toISOString(),
      });
      emitRoomPresence(room);
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.ROOM_JOIN);
    }
  });

  socket.on(CLIENT_EVENT.ROOM_LEAVE, async (payload: unknown) => {
    if (!canProcessRoomAction()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Room action rate limit exceeded",
        event: CLIENT_EVENT.ROOM_LEAVE,
      });
      return;
    }

    const parsed = roomLeaveSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid leave payload",
        event: CLIENT_EVENT.ROOM_LEAVE,
      });
      return;
    }

    const room = parsed.data.room;
    await socket.leave(room);
    removePresence(room, socket.id);
    recordRoomLeave();
    rtLog.debug("room_leave", {
      socketId: socket.id,
      userId: socket.data.user.id,
      room,
    });
    socket.emit(SERVER_EVENT.ROOM_LEFT, {
      room,
      leftAt: new Date().toISOString(),
    });
    emitRoomPresence(room);
  });

  socket.on(CLIENT_EVENT.TYPING_STATE, async (payload: unknown) => {
    if (!canProcessTyping()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Typing rate limit exceeded",
        event: CLIENT_EVENT.TYPING_STATE,
      });
      return;
    }

    const parsed = typingStateSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid typing payload",
        event: CLIENT_EVENT.TYPING_STATE,
      });
      return;
    }
    try {
      const { room, taskId, isTyping } = parsed.data;
      await assertRoomAccess(socket.data.user.id, room);
      recordTypingEvent();
      socket.to(room).emit(SERVER_EVENT.TYPING_STATE, {
        room,
        taskId,
        isTyping,
        user: {
          id: socket.data.user.id,
          fullName: socket.data.user.fullName,
        },
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.TYPING_STATE);
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter((room) => room !== socket.id);
    for (const room of rooms) {
      removePresence(room, socket.id);
      emitRoomPresence(room);
    }
  });

  socket.on("disconnect", (reason) => {
    recordConnectionClose();
    rtLog.info("disconnect", {
      socketId: socket.id,
      userId: socket.data.user?.id,
      reason,
    });
  });
}

export function initializeRealtime(httpServer: HttpServer) {
  if (!env.ENABLE_SOCKET) {
    rtLog.info("disabled", { reason: "ENABLE_SOCKET=false" });
    return null;
  }

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
      credentials: true,
    },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    transports: ["websocket", "polling"],
  });

  const rt = io.of(RT_NAMESPACE);
  rtNamespace = rt;
  rt.use(async (socket, next) => {
    try {
      await authenticateSocket(socket);
      next();
    } catch {
      recordAuthFailure();
      next(new Error("Unauthorized"));
    }
  });

  rt.on("connection", (socket) => {
    recordConnectionOpen();
    rtLog.info("connect", {
      socketId: socket.id,
      userId: socket.data.user.id,
    });
    attachRealtimeHandlers(socket);
  });

  if (!metricsTimer) {
    metricsTimer = setInterval(() => {
      rtLog.info("metrics", getRealtimeMetricsSnapshot());
    }, METRICS_LOG_INTERVAL_MS);
    metricsTimer.unref?.();
  }

  return io;
}

export function getRealtimeNamespace() {
  return rtNamespace;
}

export function getRealtimeMetricsSnapshot() {
  return getRealtimeMetrics(roomPresenceIndex.size);
}
