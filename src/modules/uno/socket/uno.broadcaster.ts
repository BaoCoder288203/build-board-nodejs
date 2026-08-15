import { randomUUID } from "node:crypto";
import { userRoom } from "../../../realtime/events.js";
import type { EngineResult, UnoDomainEvent } from "../game/game.state.js";
import { projectForPlayer } from "./uno.projection.js";
import { UNO_SERVER_EVENT, type UnoServerEvent } from "./uno.events.js";
import { unoSocketRoom } from "../shared/uno.ids.js";
import type { RuntimeSession } from "../session/game-session.store.js";
import type { PublicUnoRoom } from "../room/room.types.js";
import { getUnoNamespace } from "./uno.namespace.js";
import type { ConnectionStatus } from "../shared/uno.enums.js";

function envelope<T>(
  roomId: string,
  type: string,
  payload: T,
  extra?: { gameId?: string; sequence?: number },
): UnoServerEvent<T> {
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

function emitRoom(roomId: string, type: string, payload: unknown, extra?: { gameId?: string; sequence?: number }) {
  const rt = getUnoNamespace();
  if (!rt) return;
  rt.to(unoSocketRoom(roomId)).emit(type, envelope(roomId, type, payload, extra));
}

function emitUser(userId: string, type: string, payload: unknown, extra?: { roomId?: string; gameId?: string; sequence?: number }) {
  const rt = getUnoNamespace();
  if (!rt) return;
  rt.to(userRoom(userId)).emit(
    type,
    envelope(extra?.roomId ?? "", type, payload, extra),
  );
}

export function emitRoomUpdated(room: PublicUnoRoom) {
  emitRoom(room.id, UNO_SERVER_EVENT.ROOM_UPDATED, { room });
}

export function emitPlayerJoined(room: PublicUnoRoom, playerId: string) {
  const player = room.players.find((p) => p.playerId === playerId);
  emitRoom(room.id, UNO_SERVER_EVENT.PLAYER_JOINED, { player, room });
  emitRoomUpdated(room);
}

export function emitPlayerLeft(room: PublicUnoRoom, playerId: string, userId: string) {
  emitRoom(room.id, UNO_SERVER_EVENT.PLAYER_LEFT, { playerId, userId, room });
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
      ? UNO_SERVER_EVENT.PLAYER_DISCONNECTED
      : UNO_SERVER_EVENT.PLAYER_RECONNECTED,
    { userId, playerId, connectionStatus },
  );
}

export function emitInvite(userId: string, room: PublicUnoRoom, invitedBy: string) {
  emitUser(userId, UNO_SERVER_EVENT.ROOM_INVITE, {
    room,
    invitedBy,
  }, { roomId: room.id });
}

export function emitSnapshotToUser(
  userId: string,
  payload: unknown,
) {
  emitUser(userId, UNO_SERVER_EVENT.SNAPSHOT, payload);
}

export function emitErrorToUser(
  userId: string,
  payload: { code: string; message: string; requestId?: string },
) {
  emitUser(userId, UNO_SERVER_EVENT.ERROR, payload);
}

function connectionsFrom(session: RuntimeSession): Record<string, ConnectionStatus | undefined> {
  const state = session.engine.state;
  if (!state) return {};
  return Object.fromEntries(
    state.players.map((p) => [p.playerId, p.connectionStatus]),
  );
}

function emitPrivateStates(session: RuntimeSession) {
  const state = session.engine.state;
  if (!state) return;
  const rt = getUnoNamespace();
  if (!rt) return;
  const connections = connectionsFrom(session);
  for (const player of state.players) {
    const view = projectForPlayer(state, player.playerId, connections);
    const event = envelope(session.roomId, UNO_SERVER_EVENT.GAME_STATE, view, {
      gameId: state.gameId,
      sequence: state.sequence,
    });
    rt.to(userRoom(player.userId)).emit(UNO_SERVER_EVENT.GAME_STATE, event);
  }
}

function mapEvent(session: RuntimeSession, event: UnoDomainEvent) {
  const state = session.engine.state;
  const extra = { gameId: session.gameId, sequence: state?.sequence };
  switch (event.type) {
    case "GAME_STARTED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.GAME_STARTED, event.payload, extra);
      emitPrivateStates(session);
      break;
    case "CARD_PLAYED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.CARD_PLAYED, event.payload, extra);
      break;
    case "CARD_DRAWN": {
      const payload = event.payload as {
        playerId: string;
        drawnCount: number;
        cards?: unknown;
        sequence: number;
      };
      emitRoom(
        session.roomId,
        UNO_SERVER_EVENT.CARD_DRAWN,
        { playerId: payload.playerId, drawnCount: payload.drawnCount, sequence: payload.sequence },
        extra,
      );
      const player = state?.players.find((p) => p.playerId === payload.playerId);
      if (player) {
        emitUser(
          player.userId,
          UNO_SERVER_EVENT.CARD_DRAWN,
          {
            playerId: payload.playerId,
            drawnCount: payload.drawnCount,
            cards: payload.cards,
            sequence: payload.sequence,
          },
          { roomId: session.roomId, ...extra },
        );
      }
      break;
    }
    case "COLOR_SELECTED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.COLOR_SELECTED, event.payload, extra);
      break;
    case "UNO_DECLARED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.DECLARED, event.payload, extra);
      break;
    case "CHALLENGE_RESOLVED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.CHALLENGED, event.payload, extra);
      break;
    case "TURN_CHANGED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.TURN_CHANGED, event.payload, extra);
      break;
    case "TURN_TIMEOUT":
      emitRoom(session.roomId, UNO_SERVER_EVENT.TURN_TIMEOUT, event.payload, extra);
      break;
    case "ROUND_ENDED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.ROUND_ENDED, event.payload, extra);
      break;
    case "GAME_ENDED":
      emitRoom(session.roomId, UNO_SERVER_EVENT.GAME_ENDED, event.payload, extra);
      break;
    default:
      break;
  }
}

export function broadcastEngineResult(session: RuntimeSession, result: EngineResult) {
  for (const event of result.events) {
    mapEvent(session, event);
  }
  if (result.privateHandsChanged.length > 0) {
    emitPrivateStates(session);
  }
}
