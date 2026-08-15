import { z } from "zod";
import type { Socket } from "socket.io";
import { AppError } from "../../../common/app-error.js";
import { ENGINE_ACTION, CONNECTION_STATUS, UNO_MVP, type UnoColor } from "../shared/uno.enums.js";
import { unoError } from "../shared/uno.errors.js";
import { unoSocketRoom } from "../shared/uno.ids.js";
import * as roomService from "../room/room.service.js";
import * as gameService from "../game/game.service.js";
import * as roomRepo from "../persistence/uno-room.repository.js";
import {
  attachSocket,
  detachSocket,
  ensureRuntime,
} from "../session/game-session.store.js";
import {
  emitConnection,
  emitErrorToUser,
  emitInvite,
  emitPlayerJoined,
  emitPlayerLeft,
  emitRoomUpdated,
} from "./uno.broadcaster.js";
import { UNO_CLIENT_EVENT, type UnoAck } from "./uno.events.js";

const envelopeSchema = z.object({
  requestId: z.string().min(1).max(80),
  roomId: z.string().uuid(),
  gameId: z.string().uuid().optional(),
  payload: z.unknown().optional(),
});

const playSchema = z.object({
  cardId: z.string().min(1),
  chosenColor: z.enum(["RED", "YELLOW", "GREEN", "BLUE"]).optional(),
});

const colorSchema = z.object({
  color: z.enum(["RED", "YELLOW", "GREEN", "BLUE"]),
});

const challengeSchema = z.object({
  kind: z.enum(["WD4", "UNO_PENALTY"]),
});

const joinSchema = envelopeSchema.extend({
  payload: z.object({ asSpectator: z.boolean().optional() }).optional(),
});

const socketRooms = new Map<string, Set<string>>();

function ackError(ack: ((value: UnoAck) => void) | undefined, code: string, message: string, requestId?: string) {
  ack?.({ ok: false, code, message, requestId });
}

function parseEnvelope(payload: unknown) {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw unoError(UNO_ERROR.FORBIDDEN, "Invalid UNO payload");
  }
  return parsed.data;
}

async function withAck(
  socket: Socket,
  event: string,
  payload: unknown,
  ack: ((value: UnoAck) => void) | undefined,
  fn: (body: z.infer<typeof envelopeSchema>) => Promise<{ sequence?: number } | void>,
) {
  try {
    const body = parseEnvelope(payload);
    const result = await fn(body);
    ack?.({ ok: true, sequence: result?.sequence });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    const message = error instanceof Error ? error.message : "UNO error";
    const requestId =
      payload && typeof payload === "object" && "requestId" in payload
        ? String((payload as { requestId?: string }).requestId ?? "")
        : undefined;
    ackError(ack, code, message, requestId);
    emitErrorToUser(socket.data.user.id, {
      code,
      message,
      requestId,
    });
    void event;
  }
}

export function attachUnoHandlers(socket: Socket) {
  const userId: string = socket.data.user.id;

  socket.on(UNO_CLIENT_EVENT.ROOM_JOIN, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.ROOM_JOIN, payload, ack, async (body) => {
      const parsed = joinSchema.parse(payload);
      const result = await roomService.joinRoom(userId, body.roomId, {
        asSpectator: parsed.payload?.asSpectator,
      });
      await socket.join(unoSocketRoom(body.roomId));
      attachSocket(body.roomId, userId, socket.id);
      const rooms = socketRooms.get(socket.id) ?? new Set();
      rooms.add(body.roomId);
      socketRooms.set(socket.id, rooms);
      if (result.reconnected) {
        emitConnection(
          body.roomId,
          userId,
          result.player.playerId,
          CONNECTION_STATUS.CONNECTED,
          "reconnected",
        );
      } else {
        emitPlayerJoined(result.room, result.player.playerId);
      }
      await gameService.emitSnapshot(userId, body.roomId);
      return {};
    });
  });

  socket.on(UNO_CLIENT_EVENT.ROOM_LEAVE, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.ROOM_LEAVE, payload, ack, async (body) => {
      const before = await roomRepo.findRoomById(body.roomId);
      const leaving = before?.players.find((p) => p.userId === userId);
      const room = await roomService.leaveRoom(userId, body.roomId);
      await socket.leave(unoSocketRoom(body.roomId));
      detachSocket(body.roomId, userId, socket.id);
      socketRooms.get(socket.id)?.delete(body.roomId);
      emitPlayerLeft(room, leaving?.id ?? "", userId);
      if (room.status === "PLAYING" && leaving) {
        await gameService.onPlayerLeftMidGame(body.roomId, leaving.id);
      }
      return {};
    });
  });

  socket.on(UNO_CLIENT_EVENT.PLAYER_READY, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.PLAYER_READY, payload, ack, async (body) => {
      const room = await roomService.setReady(userId, body.roomId, true);
      emitRoomUpdated(room);
      return {};
    });
  });

  socket.on(UNO_CLIENT_EVENT.PLAYER_UNREADY, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.PLAYER_UNREADY, payload, ack, async (body) => {
      const room = await roomService.setReady(userId, body.roomId, false);
      emitRoomUpdated(room);
      return {};
    });
  });

  socket.on(UNO_CLIENT_EVENT.GAME_START, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.GAME_START, payload, ack, async (body) => {
      const result = await gameService.startGame(userId, body.roomId, body.requestId);
      return { sequence: result.ok ? result.sequence : undefined };
    });
  });

  socket.on(UNO_CLIENT_EVENT.CARD_PLAY, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.CARD_PLAY, payload, ack, async (body) => {
      const play = playSchema.parse(body.payload ?? {});
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.PLAY_CARD,
        payload: {
          cardId: play.cardId,
          chosenColor: play.chosenColor as UnoColor | undefined,
        },
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.CARD_DRAW, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.CARD_DRAW, payload, ack, async (body) => {
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.DRAW_CARD,
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.TURN_PASS, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.TURN_PASS, payload, ack, async (body) => {
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.PASS,
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.COLOR_SELECT, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.COLOR_SELECT, payload, ack, async (body) => {
      const color = colorSchema.parse(body.payload ?? {});
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.CHOOSE_COLOR,
        payload: color,
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.DECLARE, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.DECLARE, payload, ack, async (body) => {
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.CALL_UNO,
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.CHALLENGE, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.CHALLENGE, payload, ack, async (body) => {
      const challenge = challengeSchema.parse(body.payload ?? {});
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type:
          challenge.kind === "WD4"
            ? ENGINE_ACTION.CHALLENGE_WD4
            : ENGINE_ACTION.CALL_OUT_UNO,
      });
      if (!result.ok) throw unoError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(UNO_CLIENT_EVENT.SNAPSHOT_REQUEST, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.SNAPSHOT_REQUEST, payload, ack, async (body) => {
      await gameService.emitSnapshot(userId, body.roomId);
      return {};
    });
  });

  socket.on(UNO_CLIENT_EVENT.REMATCH_REQUEST, async (payload: unknown, ack?: (v: UnoAck) => void) => {
    await withAck(socket, UNO_CLIENT_EVENT.REMATCH_REQUEST, payload, ack, async (body) => {
      const room = await gameService.rematch(userId, body.roomId, body.requestId);
      emitRoomUpdated(room);
      return {};
    });
  });
}

export async function handleUnoDisconnect(socket: Socket) {
  const userId: string | undefined = socket.data.user?.id;
  const rooms = socketRooms.get(socket.id);
  socketRooms.delete(socket.id);
  if (!userId || !rooms) return;

  for (const roomId of rooms) {
    const { remaining } = detachSocket(roomId, userId, socket.id);
    if (remaining > 0) continue;
    const player = await roomService.markConnection(
      roomId,
      userId,
      CONNECTION_STATUS.DISCONNECTED,
    );
    if (!player) continue;
    emitConnection(roomId, userId, player.id, CONNECTION_STATUS.DISCONNECTED, "disconnected");
    const runtime = ensureRuntime(roomId);
    const existing = runtime.disconnectTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      void roomService.transferHostIfNeeded(roomId).then((room) => {
        if (room) emitRoomUpdated(room);
      });
    }, UNO_MVP.disconnectGraceMs);
    timer.unref?.();
    runtime.disconnectTimers.set(userId, timer);
  }
}

export async function httpInviteAndNotify(
  userId: string,
  roomId: string,
  userIds: string[],
) {
  const result = await roomService.invitePlayers(userId, roomId, userIds);
  for (const invited of userIds) {
    emitInvite(invited, result.room, userId);
  }
  emitRoomUpdated(result.room);
  return result;
}
