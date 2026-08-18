import { z } from "zod";
import type { Socket } from "socket.io";
import { AppError } from "../../../common/app-error.js";
import { CONNECTION_STATUS, ENGINE_ACTION } from "../shared/chess.enums.js";
import { CHESS_ERROR, chessError } from "../shared/chess.errors.js";
import { chessSocketRoom } from "../shared/chess.ids.js";
import * as roomService from "../room/room.service.js";
import * as gameService from "../game/game.service.js";
import {
  attachSocket,
  detachSocket,
} from "../session/chess-session.store.js";
import {
  emitConnection,
  emitErrorToUser,
  emitInvite,
  emitPlayerJoined,
  emitPlayerLeft,
  emitRoomUpdated,
} from "./chess.broadcaster.js";
import { CHESS_CLIENT_EVENT, type ChessAck } from "./chess.events.js";

const envelopeSchema = z.object({
  requestId: z.string().min(1).max(80),
  roomId: z.string().uuid(),
  gameId: z.string().uuid().optional(),
  payload: z.unknown().optional(),
});

const joinSchema = envelopeSchema.extend({
  payload: z.object({ asSpectator: z.boolean().optional() }).optional(),
});

const moveSchema = z.object({
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});

const drawRespondSchema = z.object({
  accept: z.boolean(),
});

const socketRooms = new Map<string, Set<string>>();

function ackError(
  ack: ((value: ChessAck) => void) | undefined,
  code: string,
  message: string,
  requestId?: string,
) {
  ack?.({ ok: false, code, message, requestId });
}

function parseEnvelope(payload: unknown) {
  const parsed = envelopeSchema.safeParse(payload);
  if (!parsed.success) {
    throw chessError(CHESS_ERROR.FORBIDDEN, "Invalid Chess payload");
  }
  return parsed.data;
}

async function withAck(
  socket: Socket,
  event: string,
  payload: unknown,
  ack: ((value: ChessAck) => void) | undefined,
  fn: (body: z.infer<typeof envelopeSchema>) => Promise<{ sequence?: number } | void>,
) {
  try {
    const body = parseEnvelope(payload);
    const result = await fn(body);
    ack?.({ ok: true, sequence: result?.sequence });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "INTERNAL";
    const message = error instanceof Error ? error.message : "Chess error";
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

export function attachChessHandlers(socket: Socket) {
  const userId: string = socket.data.user.id;

  socket.on(CHESS_CLIENT_EVENT.ROOM_JOIN, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.ROOM_JOIN, payload, ack, async (body) => {
      const parsed = joinSchema.parse(payload);
      const result = await roomService.joinRoom(userId, body.roomId, {
        asSpectator: parsed.payload?.asSpectator,
      });
      await socket.join(chessSocketRoom(body.roomId));
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

  socket.on(CHESS_CLIENT_EVENT.ROOM_LEAVE, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.ROOM_LEAVE, payload, ack, async (body) => {
      const before = await roomService.getRoom(userId, body.roomId);
      const leaving = before.players.find((p) => p.userId === userId);
      const room = await gameService.leaveGame(userId, body.roomId);
      await socket.leave(chessSocketRoom(body.roomId));
      detachSocket(body.roomId, userId, socket.id);
      socketRooms.get(socket.id)?.delete(body.roomId);
      emitPlayerLeft(room, leaving?.playerId ?? "", userId);
      return {};
    });
  });

  socket.on(CHESS_CLIENT_EVENT.PLAYER_READY, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.PLAYER_READY, payload, ack, async (body) => {
      const room = await roomService.setReady(userId, body.roomId, true);
      emitRoomUpdated(room);
      return {};
    });
  });

  socket.on(CHESS_CLIENT_EVENT.PLAYER_UNREADY, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.PLAYER_UNREADY, payload, ack, async (body) => {
      const room = await roomService.setReady(userId, body.roomId, false);
      emitRoomUpdated(room);
      return {};
    });
  });

  socket.on(CHESS_CLIENT_EVENT.GAME_START, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.GAME_START, payload, ack, async (body) => {
      const result = await gameService.startGame(userId, body.roomId, body.requestId);
      return { sequence: result.ok ? result.sequence : undefined };
    });
  });

  socket.on(CHESS_CLIENT_EVENT.MOVE, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.MOVE, payload, ack, async (body) => {
      const move = moveSchema.parse(body.payload ?? {});
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.MOVE,
        payload: move,
      });
      if (!result.ok) throw chessError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(CHESS_CLIENT_EVENT.RESIGN, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.RESIGN, payload, ack, async (body) => {
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.RESIGN,
      });
      if (!result.ok) throw chessError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(CHESS_CLIENT_EVENT.DRAW_OFFER, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.DRAW_OFFER, payload, ack, async (body) => {
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.OFFER_DRAW,
      });
      if (!result.ok) throw chessError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(CHESS_CLIENT_EVENT.DRAW_RESPOND, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.DRAW_RESPOND, payload, ack, async (body) => {
      const respond = drawRespondSchema.parse(body.payload ?? {});
      const result = await gameService.dispatchPlayerAction(userId, body.roomId, {
        requestId: body.requestId,
        gameId: body.gameId,
        type: ENGINE_ACTION.RESPOND_DRAW,
        payload: respond,
      });
      if (!result.ok) throw chessError(result.code, undefined, body.requestId);
      return { sequence: result.sequence };
    });
  });

  socket.on(CHESS_CLIENT_EVENT.SNAPSHOT_REQUEST, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.SNAPSHOT_REQUEST, payload, ack, async (body) => {
      await gameService.emitSnapshot(userId, body.roomId);
      return {};
    });
  });

  socket.on(CHESS_CLIENT_EVENT.REMATCH_REQUEST, async (payload: unknown, ack?: (v: ChessAck) => void) => {
    await withAck(socket, CHESS_CLIENT_EVENT.REMATCH_REQUEST, payload, ack, async (body) => {
      const room = await gameService.rematch(userId, body.roomId, body.requestId);
      emitRoomUpdated(room);
      return {};
    });
  });
}

export async function handleChessDisconnect(socket: Socket) {
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
