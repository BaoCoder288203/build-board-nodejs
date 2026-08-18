import { randomUUID } from "node:crypto";
import { userRoom } from "../../../realtime/events.js";
import type { ChessActionResult, ChessDomainEvent } from "../game/chess-engine.js";
import { CHESS_SERVER_EVENT, type ChessServerEvent } from "./chess.events.js";
import { chessSocketRoom } from "../shared/chess.ids.js";
import type { ChessRuntimeSession } from "../session/chess-session.store.js";
import type { PublicChessRoom } from "../room/room.types.js";
import { getChessNamespace } from "./chess.namespace.js";
import type { ConnectionStatus } from "../shared/chess.enums.js";

function envelope<T>(
  roomId: string,
  type: string,
  payload: T,
  extra?: { gameId?: string; sequence?: number },
): ChessServerEvent<T> {
  return {
    eventId: randomUUID(),
    roomId,
    gameId: extra?.gameId,
    sequence: extra?.sequence,
    type,
    payload,
    occurredAt: new Date().toISOString(),
  };
}

function emitRoom(
  roomId: string,
  type: string,
  payload: unknown,
  extra?: { gameId?: string; sequence?: number },
) {
  const rt = getChessNamespace();
  if (!rt) return;
  rt.to(chessSocketRoom(roomId)).emit(type, envelope(roomId, type, payload, extra));
}

function emitUser(
  userId: string,
  type: string,
  payload: unknown,
  extra?: { roomId?: string; gameId?: string; sequence?: number },
) {
  const rt = getChessNamespace();
  if (!rt) return;
  rt.to(userRoom(userId)).emit(
    type,
    envelope(extra?.roomId ?? "", type, payload, extra),
  );
}

export function emitRoomUpdated(room: PublicChessRoom) {
  emitRoom(room.id, CHESS_SERVER_EVENT.ROOM_UPDATED, { room });
}

export function emitPlayerJoined(room: PublicChessRoom, playerId: string) {
  const player = room.players.find((p) => p.playerId === playerId);
  emitRoom(room.id, CHESS_SERVER_EVENT.PLAYER_JOINED, { player, room });
  emitRoomUpdated(room);
}

export function emitPlayerLeft(room: PublicChessRoom, playerId: string, userId: string) {
  emitRoom(room.id, CHESS_SERVER_EVENT.PLAYER_LEFT, { playerId, userId, room });
  emitRoomUpdated(room);
}

export function emitConnection(
  roomId: string,
  userId: string,
  playerId: string,
  connectionStatus: ConnectionStatus,
  kind: "disconnected" | "reconnected",
) {
  emitRoom(
    roomId,
    kind === "disconnected"
      ? CHESS_SERVER_EVENT.PLAYER_DISCONNECTED
      : CHESS_SERVER_EVENT.PLAYER_RECONNECTED,
    { userId, playerId, connectionStatus },
  );
}

export function emitInvite(userId: string, room: PublicChessRoom, invitedBy: string) {
  emitUser(
    userId,
    CHESS_SERVER_EVENT.ROOM_INVITE,
    { room, invitedBy },
    { roomId: room.id },
  );
}

export function emitSnapshotToUser(userId: string, payload: unknown) {
  emitUser(userId, CHESS_SERVER_EVENT.SNAPSHOT, payload);
}

export function emitErrorToUser(
  userId: string,
  payload: { code: string; message: string; requestId?: string },
) {
  emitUser(userId, CHESS_SERVER_EVENT.ERROR, payload);
}

export function emitClockSync(
  roomId: string,
  payload: unknown,
  extra?: { gameId?: string; sequence?: number },
) {
  emitRoom(roomId, CHESS_SERVER_EVENT.CLOCK_SYNC, payload, extra);
}

function emitPublicState(session: ChessRuntimeSession) {
  const engine = session.engine;
  if (!engine) return;
  emitRoom(
    session.roomId,
    CHESS_SERVER_EVENT.GAME_STATE,
    engine.publicGame(),
    { gameId: session.gameId, sequence: engine.state.sequence },
  );
}

function mapEvent(session: ChessRuntimeSession, event: ChessDomainEvent) {
  const extra = { gameId: session.gameId, sequence: session.engine?.state.sequence };
  switch (event.type) {
    case "GAME_STARTED":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.GAME_STARTED, event.payload, extra);
      emitPublicState(session);
      break;
    case "MOVED":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.MOVED, event.payload, extra);
      break;
    case "DRAW_OFFERED":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.DRAW_OFFERED, event.payload, extra);
      break;
    case "DRAW_RESOLVED":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.DRAW_RESOLVED, event.payload, extra);
      break;
    case "CLOCK_SYNC":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.CLOCK_SYNC, event.payload, extra);
      break;
    case "GAME_ENDED":
      emitRoom(session.roomId, CHESS_SERVER_EVENT.GAME_ENDED, event.payload, extra);
      emitPublicState(session);
      break;
    default:
      break;
  }
}

export function broadcastEngineResult(session: ChessRuntimeSession, result: ChessActionResult) {
  if (!result.ok) return;
  for (const event of result.events) {
    mapEvent(session, event);
  }
}
