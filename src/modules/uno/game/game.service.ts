import { CONNECTION_STATUS, END_REASON, ENGINE_ACTION, PLAYER_STATUS, ROOM_STATUS, UNO_GAME_STATUS, UNO_MVP, type ConnectionStatus, type UnoEndReason } from "../shared/uno.enums.js";
import { UNO_ERROR, unoError } from "../shared/uno.errors.js";
import { GameEngine, dealNextRound } from "../game/game.engine.js";
import type { EngineCommand, EngineResult } from "../game/game.state.js";
import type { GameRules } from "../game/game.state.js";
import * as roomRepo from "../persistence/uno-room.repository.js";
import * as resultRepo from "../persistence/uno-result.repository.js";
import * as roomService from "../room/room.service.js";
import {
  bindSession,
  clearGame,
  getSessionByRoom,
  getState,
  type RuntimeSession,
} from "../session/game-session.store.js";
import { broadcastEngineResult, emitRoomUpdated, emitSnapshotToUser } from "../socket/uno.broadcaster.js";

function requirePlayer(room: Awaited<ReturnType<typeof roomRepo.findRoomById>>, userId: string) {
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw unoError(UNO_ERROR.NOT_ROOM_MEMBER);
  if (player.isSpectator) throw unoError(UNO_ERROR.SPECTATOR_ACTION_DENIED);
  return { room, player };
}

async function persistSessionMeta(session: RuntimeSession) {
  const state = session.engine.state;
  if (!state) return;
  await resultRepo.updateSession(session.gameId, {
    status: state.status,
    sequence: state.sequence,
    roundNumber: state.roundNumber,
    scores: state.scores,
    winnerId: state.winnerId ?? null,
    endReason: state.endReason ?? null,
    endedAt:
      state.status === UNO_GAME_STATUS.FINISHED || state.status === UNO_GAME_STATUS.ABORTED
        ? new Date()
        : null,
  });
}

function scheduleChallengeExpiry(session: RuntimeSession) {
  if (session.challengeTimer) {
    clearTimeout(session.challengeTimer);
    session.challengeTimer = null;
  }
  const challenge = session.engine.state?.challenge;
  if (!challenge) return;
  const delay = Math.max(0, challenge.expiresAt - Date.now());
  session.challengeTimer = setTimeout(() => {
    void dispatchSystem(session, {
      gameId: session.gameId,
      requestId: `expire-challenge:${session.gameId}:${session.engine.state?.sequence ?? 0}`,
      type: ENGINE_ACTION.EXPIRE_CHALLENGE,
    });
  }, delay);
  session.challengeTimer.unref?.();
}

async function autoActIfDisconnected(session: RuntimeSession) {
  const state = session.engine.state;
  if (!state || state.status !== UNO_GAME_STATUS.PLAYING) return;
  const currentId = state.currentPlayerId;
  if (!currentId) return;
  const current = state.players.find((p) => p.playerId === currentId);
  if (!current || current.connectionStatus !== CONNECTION_STATUS.DISCONNECTED) return;
  await dispatchSystem(session, {
    gameId: session.gameId,
    playerId: currentId,
    requestId: `auto-draw:${session.gameId}:${state.sequence}:${state.turnNumber}`,
    type: ENGINE_ACTION.DRAW_CARD,
  });
  const after = session.engine.state;
  if (after?.lastDrawnCardId && after.currentPlayerId === currentId) {
    await dispatchSystem(session, {
      gameId: session.gameId,
      playerId: currentId,
      requestId: `auto-pass:${session.gameId}:${after.sequence}:${after.turnNumber}`,
      type: ENGINE_ACTION.PASS,
    });
  }
}

async function afterCommit(session: RuntimeSession, result: EngineResult) {
  await persistSessionMeta(session);
  broadcastEngineResult(session, result);
  scheduleChallengeExpiry(session);

  const state = result.state;
  if (state.status === UNO_GAME_STATUS.ROUND_FINISHED && state.rules.autoStartNextRound) {
    const next = dealNextRound(state, Date.now());
    session.engine.state = next.state;
    await persistSessionMeta(session);
    broadcastEngineResult(session, next);
  }

  if (state.status === UNO_GAME_STATUS.FINISHED || result.state.status === UNO_GAME_STATUS.FINISHED) {
    const finished = session.engine.state;
    if (finished) {
      await resultRepo.createResult({
        session: { connect: { id: session.gameId } },
        scores: finished.scores,
        winnerId: finished.winnerId ?? null,
      }).catch(() => undefined);
      await roomRepo.updateRoom(session.roomId, { status: ROOM_STATUS.FINISHED });
    }
  }

  await autoActIfDisconnected(session);
}

async function dispatchSystem(session: RuntimeSession, command: EngineCommand) {
  return session.mutex.run(async () => {
    const result = session.engine.apply(command);
    if (result.ok) await afterCommit(session, result);
    return result;
  });
}

export async function startGame(userId: string, roomId: string, requestId: string) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  if (!player.isHost) throw unoError(UNO_ERROR.NOT_HOST);
  if (room.status === ROOM_STATUS.PLAYING) throw unoError(UNO_ERROR.ROOM_ALREADY_PLAYING);
  if (room.status === ROOM_STATUS.CLOSED) throw unoError(UNO_ERROR.ROOM_CLOSED);

  const contestants = room.players.filter((p) => !p.isSpectator);
  if (contestants.length < UNO_MVP.minPlayers) throw unoError(UNO_ERROR.NOT_ENOUGH_PLAYERS);
  if (contestants.some((p) => p.status !== PLAYER_STATUS.READY)) {
    throw unoError(UNO_ERROR.NOT_READY);
  }

  const sessionRow = await resultRepo.createSession({
    room: { connect: { id: roomId } },
    status: "DEALING",
    roundNumber: 1,
    sequence: 0,
    scores: Object.fromEntries(contestants.map((p) => [p.id, 0])),
    rules: room.rules as GameRules,
  });

  const engine = new GameEngine();
  const session = bindSession({ roomId, gameId: sessionRow.id, engine });

  const result = engine.apply({
    gameId: sessionRow.id,
    playerId: player.id,
    requestId,
    type: ENGINE_ACTION.START_GAME,
    payload: {
      roomId,
      rules: room.rules,
      players: contestants
        .sort((a, b) => (a.seatIndex ?? 0) - (b.seatIndex ?? 0))
        .map((p, index) => ({
          playerId: p.id,
          userId: p.userId,
          seatIndex: p.seatIndex ?? index,
        })),
    },
  });

  if (!result.ok) throw unoError(result.code, undefined, requestId);

  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.PLAYING });
  for (const p of contestants) {
    await roomRepo.updatePlayer(p.id, { status: PLAYER_STATUS.PLAYING });
  }
  await afterCommit(session, result);
  return result;
}

export async function dispatchPlayerAction(
  userId: string,
  roomId: string,
  command: Omit<EngineCommand, "playerId" | "gameId"> & { gameId?: string },
) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  const session = getSessionByRoom(roomId);
  if (!session?.engine.state) throw unoError(UNO_ERROR.GAME_NOT_STARTED);
  if (command.gameId && command.gameId !== session.gameId) {
    throw unoError(UNO_ERROR.GAME_NOT_FOUND);
  }

  return session.mutex.run(async () => {
    const result = session.engine.apply({
      ...command,
      gameId: session.gameId,
      playerId: player.id,
    });
    if (result.ok) await afterCommit(session, result);
    return result;
  });
}

export async function rematch(userId: string, roomId: string, requestId: string) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  if (!player.isHost) throw unoError(UNO_ERROR.NOT_HOST);
  if (room.status !== ROOM_STATUS.FINISHED) {
    throw unoError(UNO_ERROR.GAME_NOT_PLAYING, "Rematch requires a finished game");
  }
  for (const p of room.players.filter((x) => !x.isSpectator)) {
    await roomRepo.updatePlayer(p.id, { status: PLAYER_STATUS.WAITING });
  }
  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.WAITING });
  const latest = await roomRepo.findRoomById(roomId);
  return latest ? roomService.toPublicRoom(latest) : roomService.toPublicRoom(room);
}

export async function snapshot(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  const publicRoom = roomService.toPublicRoom(room);
  const state = getState(roomId);
  const connections = Object.fromEntries(
    room.players.map((p) => [p.id, p.connectionStatus]),
  ) as Record<string, ConnectionStatus>;
  return {
    sequence: state?.sequence ?? 0,
    serverTime: new Date().toISOString(),
    room: publicRoom,
    game: state
      ? (
          await import("../socket/uno.projection.js")
        ).projectForPlayer(state, player?.id ?? null, connections)
      : null,
  };
}

export async function emitSnapshot(userId: string, roomId: string) {
  const payload = await snapshot(userId, roomId);
  emitSnapshotToUser(userId, payload);
  return payload;
}

export async function abortGame(roomId: string, reason: UnoEndReason) {
  const session = getSessionByRoom(roomId);
  const state = session?.engine.state;
  if (!session || !state) return;
  if (state.status === UNO_GAME_STATUS.FINISHED || state.status === UNO_GAME_STATUS.ABORTED) {
    return;
  }
  state.status = UNO_GAME_STATUS.ABORTED;
  state.endReason = reason;
  state.sequence += 1;
  await persistSessionMeta(session);
  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.CLOSED });
  broadcastEngineResult(session, {
    ok: true,
    sequence: state.sequence,
    state,
    events: [
      {
        type: "GAME_ENDED",
        payload: {
          winnerId: state.winnerId,
          reason: state.endReason,
          scores: state.scores,
          sequence: state.sequence,
        },
      },
    ],
    privateHandsChanged: [],
  });
}

export async function onPlayerLeftMidGame(roomId: string, playerId: string) {
  const session = getSessionByRoom(roomId);
  const state = session?.engine.state;
  if (!state) return;
  const player = state.players.find((p) => p.playerId === playerId);
  if (player) player.connectionStatus = CONNECTION_STATUS.LEFT;
  const remaining = state.players.filter(
    (p) =>
      p.connectionStatus !== CONNECTION_STATUS.LEFT &&
      p.connectionStatus !== CONNECTION_STATUS.REMOVED &&
      p.status === PLAYER_STATUS.PLAYING,
  );
  if (!session) return;
  if (remaining.length === 1 && remaining[0]) {
    await returnRoomToLobby(roomId, session);
    return;
  }
  if (remaining.length === 0) {
    await abortGame(roomId, END_REASON.ABANDONED);
  }
}

async function returnRoomToLobby(roomId: string, session: RuntimeSession) {
  const state = session.engine.state;
  if (state) {
    state.status = UNO_GAME_STATUS.ABORTED;
    state.endReason = END_REASON.LAST_PLAYER_REMAINING;
    state.winnerId = undefined;
    state.sequence += 1;
    await persistSessionMeta(session);
  }
  clearGame(roomId);

  const room = await roomRepo.findRoomById(roomId);
  if (!room) return;

  for (const player of room.players) {
    if (player.connectionStatus === CONNECTION_STATUS.LEFT || player.connectionStatus === CONNECTION_STATUS.REMOVED) {
      await roomRepo.deletePlayer(player.id);
      continue;
    }
    if (player.isSpectator) continue;
    await roomRepo.updatePlayer(player.id, {
      status: PLAYER_STATUS.WAITING,
    });
  }

  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.WAITING });
  const latest = await roomRepo.findRoomById(roomId);
  if (!latest) return;
  const publicRoom = roomService.toPublicRoom(latest);
  emitRoomUpdated(publicRoom);
  for (const player of latest.players) {
    await emitSnapshot(player.userId, roomId);
  }
}
