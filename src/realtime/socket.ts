import type { Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import {
  Server as SocketIOServer,
  type Namespace,
  type Socket,
} from "socket.io";
import { AppError } from "../common/app-error.js";
import { env } from "../config/env.js";
import { prisma } from "../database/prisma.js";
import { authenticateSocket } from "./auth.js";
import {
  CLIENT_EVENT,
  RT_NAMESPACE,
  SERVER_EVENT,
  meetingMediaStateSchema,
  meetingModerationSchema,
  meetingSignalAnswerSchema,
  meetingSignalIceSchema,
  meetingSignalOfferSchema,
  roomJoinSchema,
  roomLeaveSchema,
  typingStateSchema,
  userRoom,
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
const MAX_SIGNALING_EVENTS_PER_MINUTE = 300;
const MAX_ROOMS_PER_SOCKET = 24;
const METRICS_LOG_INTERVAL_MS = 60_000;

let rtNamespace: Namespace | null = null;
let metricsTimer: ReturnType<typeof setInterval> | null = null;

function isCollaborativeRoom(room: string) {
  return (
    room.startsWith("workspace:") ||
    room.startsWith("board:") ||
    room.startsWith("task:") ||
    room.startsWith("meeting:")
  );
}

const roomPresenceIndex = new Map<
  string,
  Map<string, { id: string; fullName: string; avatar: string | null }>
>();

type MeetingMediaSnapshot = {
  userId: string;
  fullName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  screenStreamId: string | null;
};

/** In-memory last-known media flags per meeting participant (for late joiners). */
const meetingMediaIndex = new Map<string, Map<string, MeetingMediaSnapshot>>();

function upsertMeetingMedia(
  meetingId: string,
  snapshot: MeetingMediaSnapshot,
) {
  const current = meetingMediaIndex.get(meetingId) ?? new Map();
  current.set(snapshot.userId, snapshot);
  meetingMediaIndex.set(meetingId, current);
}

function removeMeetingMediaUser(meetingId: string, userId: string) {
  const current = meetingMediaIndex.get(meetingId);
  if (!current) return;
  current.delete(userId);
  if (current.size === 0) {
    meetingMediaIndex.delete(meetingId);
  }
}

function clearMeetingMedia(meetingId: string) {
  meetingMediaIndex.delete(meetingId);
}

function emitMeetingMediaSync(socket: Socket, meetingId: string) {
  const current = meetingMediaIndex.get(meetingId);
  const states = current
    ? [...current.values()].map((snap) => ({
        user: { id: snap.userId, fullName: snap.fullName },
        audioEnabled: snap.audioEnabled,
        videoEnabled: snap.videoEnabled,
        screenSharing: snap.screenSharing,
        screenStreamId: snap.screenStreamId,
      }))
    : [];
  socket.emit(SERVER_EVENT.MEETING_MEDIA_SYNC, {
    meetingId,
    states,
    occurredAt: new Date().toISOString(),
  });
}

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
  const canProcessSignaling = createRateLimiter(MAX_SIGNALING_EVENTS_PER_MINUTE);

  async function assertMeetingRelayAccess(meetingId: string, toUserId?: string) {
    const meeting = await prisma.meeting.findFirst({
      where: { id: meetingId, status: "ACTIVE" },
      include: {
        participants: {
          where: { leftAt: null },
          select: { userId: true },
        },
      },
    });
    if (!meeting) {
      throw new AppError("Meeting not found", 404, "ROOM_NOT_FOUND");
    }
    await assertRoomAccess(socket.data.user.id, `meeting:${meetingId}`);
    const participantIds = new Set(meeting.participants.map((p) => p.userId));
    if (!participantIds.has(socket.data.user.id)) {
      throw new AppError("Forbidden meeting relay", 403, "FORBIDDEN");
    }
    if (toUserId && !participantIds.has(toUserId)) {
      throw new AppError("Target is not in meeting", 403, "FORBIDDEN");
    }
  }

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
      const joinedRooms = [...socket.rooms].filter(
        (r) => r !== socket.id && isCollaborativeRoom(r),
      );
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
      if (room.startsWith("meeting:")) {
        emitMeetingMediaSync(socket, room.slice("meeting:".length));
      }
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
    if (room.startsWith("meeting:")) {
      removeMeetingMediaUser(room.slice("meeting:".length), socket.data.user.id);
    }
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

  socket.on(CLIENT_EVENT.MEETING_SIGNAL_OFFER, async (payload: unknown) => {
    if (!canProcessSignaling()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Meeting signaling rate limit exceeded",
        event: CLIENT_EVENT.MEETING_SIGNAL_OFFER,
      });
      return;
    }
    const parsed = meetingSignalOfferSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid meeting offer payload",
        event: CLIENT_EVENT.MEETING_SIGNAL_OFFER,
      });
      return;
    }
    try {
      const { meetingId, toUserId, sdp } = parsed.data;
      await assertMeetingRelayAccess(meetingId, toUserId);
      socket.to(userRoom(toUserId)).emit(SERVER_EVENT.MEETING_SIGNAL_OFFER, {
        meetingId,
        fromUserId: socket.data.user.id,
        toUserId,
        sdp,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.MEETING_SIGNAL_OFFER);
    }
  });

  socket.on(CLIENT_EVENT.MEETING_SIGNAL_ANSWER, async (payload: unknown) => {
    if (!canProcessSignaling()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Meeting signaling rate limit exceeded",
        event: CLIENT_EVENT.MEETING_SIGNAL_ANSWER,
      });
      return;
    }
    const parsed = meetingSignalAnswerSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid meeting answer payload",
        event: CLIENT_EVENT.MEETING_SIGNAL_ANSWER,
      });
      return;
    }
    try {
      const { meetingId, toUserId, sdp } = parsed.data;
      await assertMeetingRelayAccess(meetingId, toUserId);
      socket.to(userRoom(toUserId)).emit(SERVER_EVENT.MEETING_SIGNAL_ANSWER, {
        meetingId,
        fromUserId: socket.data.user.id,
        toUserId,
        sdp,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.MEETING_SIGNAL_ANSWER);
    }
  });

  socket.on(CLIENT_EVENT.MEETING_SIGNAL_ICE, async (payload: unknown) => {
    if (!canProcessSignaling()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Meeting signaling rate limit exceeded",
        event: CLIENT_EVENT.MEETING_SIGNAL_ICE,
      });
      return;
    }
    const parsed = meetingSignalIceSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid meeting ICE payload",
        event: CLIENT_EVENT.MEETING_SIGNAL_ICE,
      });
      return;
    }
    try {
      const { meetingId, toUserId, candidate, sdpMid, sdpMLineIndex } = parsed.data;
      await assertMeetingRelayAccess(meetingId, toUserId);
      socket.to(userRoom(toUserId)).emit(SERVER_EVENT.MEETING_SIGNAL_ICE, {
        meetingId,
        fromUserId: socket.data.user.id,
        toUserId,
        candidate,
        sdpMid: sdpMid ?? null,
        sdpMLineIndex: sdpMLineIndex ?? null,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.MEETING_SIGNAL_ICE);
    }
  });

  socket.on(CLIENT_EVENT.MEETING_MEDIA_STATE, async (payload: unknown) => {
    if (!canProcessSignaling()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Meeting media rate limit exceeded",
        event: CLIENT_EVENT.MEETING_MEDIA_STATE,
      });
      return;
    }
    const parsed = meetingMediaStateSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid meeting media payload",
        event: CLIENT_EVENT.MEETING_MEDIA_STATE,
      });
      return;
    }
    try {
      const {
        meetingId,
        audioEnabled,
        videoEnabled,
        screenSharing,
        screenStreamId,
      } = parsed.data;
      await assertMeetingRelayAccess(meetingId);
      const payloadOut = {
        meetingId,
        user: {
          id: socket.data.user.id,
          fullName: socket.data.user.fullName,
        },
        audioEnabled,
        videoEnabled,
        screenSharing,
        screenStreamId: screenStreamId ?? null,
        occurredAt: new Date().toISOString(),
      };
      upsertMeetingMedia(meetingId, {
        userId: payloadOut.user.id,
        fullName: payloadOut.user.fullName,
        audioEnabled,
        videoEnabled,
        screenSharing,
        screenStreamId: screenStreamId ?? null,
      });
      socket.to(`meeting:${meetingId}`).emit(SERVER_EVENT.MEETING_MEDIA_STATE, payloadOut);
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.MEETING_MEDIA_STATE);
    }
  });

  socket.on(CLIENT_EVENT.MEETING_MODERATION, async (payload: unknown) => {
    if (!canProcessSignaling()) {
      emitSocketError(socket, {
        code: "RATE_LIMITED",
        message: "Meeting moderation rate limit exceeded",
        event: CLIENT_EVENT.MEETING_MODERATION,
      });
      return;
    }
    const parsed = meetingModerationSchema.safeParse(payload);
    if (!parsed.success) {
      emitSocketError(socket, {
        code: "BAD_PAYLOAD",
        message: "Invalid meeting moderation payload",
        event: CLIENT_EVENT.MEETING_MODERATION,
      });
      return;
    }
    try {
      const { meetingId, targetUserId, audioEnabled, videoEnabled } = parsed.data;
      if (audioEnabled === undefined && videoEnabled === undefined) {
        emitSocketError(socket, {
          code: "BAD_PAYLOAD",
          message: "Moderation requires audioEnabled and/or videoEnabled",
          event: CLIENT_EVENT.MEETING_MODERATION,
        });
        return;
      }
      await assertMeetingRelayAccess(meetingId, targetUserId);
      const host = await prisma.meetingParticipant.findFirst({
        where: {
          meetingId,
          userId: socket.data.user.id,
          leftAt: null,
          isHost: true,
        },
      });
      if (!host) {
        throw new AppError("Only the meeting host can moderate", 403, "FORBIDDEN");
      }
      if (targetUserId === socket.data.user.id) {
        throw new AppError("Cannot moderate yourself", 409, "BAD_PAYLOAD");
      }
      socket.to(userRoom(targetUserId)).emit(SERVER_EVENT.MEETING_MODERATION, {
        meetingId,
        fromUserId: socket.data.user.id,
        targetUserId,
        audioEnabled,
        videoEnabled,
        occurredAt: new Date().toISOString(),
      });
    } catch (error) {
      handleError(socket, error, CLIENT_EVENT.MEETING_MODERATION);
    }
  });

  socket.on("disconnecting", () => {
    const rooms = [...socket.rooms].filter(
      (room) => room !== socket.id && isCollaborativeRoom(room),
    );
    for (const room of rooms) {
      removePresence(room, socket.id);
      if (room.startsWith("meeting:")) {
        removeMeetingMediaUser(room.slice("meeting:".length), socket.data.user.id);
      }
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

  if (env.REDIS_URL) {
    try {
      const pubClient = new Redis(env.REDIS_URL, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      });
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));
      rtLog.info("redis_adapter", { enabled: true });
    } catch (error) {
      rtLog.error("redis_adapter_failed", {
        message: error instanceof Error ? error.message : "unknown",
      });
    }
  } else {
    rtLog.info("redis_adapter", { enabled: false, reason: "REDIS_URL unset" });
  }

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
    const personalRoom = userRoom(socket.data.user.id);
    void socket.join(personalRoom);
    rtLog.info("connect", {
      socketId: socket.id,
      userId: socket.data.user.id,
      userRoom: personalRoom,
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

export function clearMeetingMediaState(meetingId: string) {
  clearMeetingMedia(meetingId);
}

export function getRealtimeMetricsSnapshot() {
  return getRealtimeMetrics(roomPresenceIndex.size);
}
