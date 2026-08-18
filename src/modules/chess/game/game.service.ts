import { Chess } from "chess.js";
import {
  CHESS_GAME_STATUS,
  CHESS_MVP,
  CONNECTION_STATUS,
  END_REASON,
  ENGINE_ACTION,
  PLAYER_STATUS,
  ROOM_STATUS,
  type ChessEndReason,
  type ChessEngineActionType,
} from "../shared/chess.enums.js";
import { CHESS_ERROR, chessError } from "../shared/chess.errors.js";
import { ChessEngine, type ChessActionResult, type ChessEngineCommand } from "./chess-engine.js";
import * as roomRepo from "../persistence/chess-room.repository.js";
import * as resultRepo from "../persistence/chess-result.repository.js";
import * as roomService from "../room/room.service.js";
import {
  bindSession,
  clearGame,
  getSessionByRoom,
  type ChessRuntimeSession,
} from "../session/chess-session.store.js";
import {
  broadcastEngineResult,
  emitClockSync,
  emitRoomUpdated,
  emitSnapshotToUser,
} from "../socket/chess.broadcaster.js";

const CLOCK_TICK_MS = 1_000;

function requirePlayer(room: Awaited<ReturnType<typeof roomRepo.findRoomById>>, userId: string) {
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);
  if (player.isSpectator) throw chessError(CHESS_ERROR.SPECTATOR_ACTION_DENIED);
  return { room, player };
}

function requireSession(roomId: string) {
  const session = getSessionByRoom(roomId);
  if (!session?.engine) throw chessError(CHESS_ERROR.GAME_NOT_STARTED);
  return session;
}

async function persistSession(session: ChessRuntimeSession) {
  const state = session.engine?.state;
  if (!state || !session.gameId) return;
  await resultRepo.updateSession(session.gameId, {
    status: state.status,
    fen: state.fen,
    pgn: state.pgn,
    moves: state.moves,
    whiteTimeMs: state.clocks.whiteTimeMs,
    blackTimeMs: state.clocks.blackTimeMs,
    sequence: state.sequence,
    winnerId: state.winnerId,
    endReason: state.endReason,
    endedAt:
      state.status === CHESS_GAME_STATUS.FINISHED || state.status === CHESS_GAME_STATUS.ABORTED
        ? new Date()
        : null,
  });
}

async function persistResult(session: ChessRuntimeSession) {
  const state = session.engine?.state;
  if (!state || !session.gameId) return;
  if (state.status !== CHESS_GAME_STATUS.FINISHED && state.status !== CHESS_GAME_STATUS.ABORTED) {
    return;
  }
  await resultRepo
    .createResult({
      session: { connect: { id: session.gameId } },
      pgn: state.pgn,
      fen: state.fen,
      winnerId: state.winnerId,
      reason: state.endReason ?? END_REASON.ABANDONED,
    })
    .catch(() => undefined);
}

function stopClockLoop(session: ChessRuntimeSession) {
  if (!session.clockTimer) return;
  clearInterval(session.clockTimer);
  session.clockTimer = null;
}

function startClockLoop(session: ChessRuntimeSession) {
  stopClockLoop(session);
  session.clockTimer = setInterval(() => {
    void session.mutex.run(async () => {
      const engine = session.engine;
      if (!engine) {
        stopClockLoop(session);
        return;
      }
      const timeout = engine.checkTimeout(Date.now());
      if (timeout?.ok) {
        stopClockLoop(session);
        await persistSession(session);
        await persistResult(session);
        await roomRepo.updateRoom(session.roomId, { status: ROOM_STATUS.FINISHED });
        const contestants = (await roomRepo.findRoomById(session.roomId))?.players ?? [];
        for (const player of contestants) {
          if (player.isSpectator) continue;
          await roomRepo.updatePlayer(player.id, { status: PLAYER_STATUS.FINISHED });
        }
        broadcastEngineResult(session, timeout);
        return;
      }
      emitClockSync(session.roomId, engine.syncClocks(Date.now()), {
        gameId: session.gameId,
        sequence: engine.state.sequence,
      });
    });
  }, CLOCK_TICK_MS);
  session.clockTimer.unref?.();
}

async function afterCommit(session: ChessRuntimeSession, result: ChessActionResult) {
  if (!result.ok || !session.engine) return;
  await persistSession(session);
  broadcastEngineResult(session, result);

  const status = session.engine.state.status;
  if (status === CHESS_GAME_STATUS.FINISHED || status === CHESS_GAME_STATUS.ABORTED) {
    stopClockLoop(session);
    await persistResult(session);
    await roomRepo.updateRoom(session.roomId, {
      status: status === CHESS_GAME_STATUS.ABORTED ? ROOM_STATUS.CLOSED : ROOM_STATUS.FINISHED,
    });
    const room = await roomRepo.findRoomById(session.roomId);
    for (const player of room?.players ?? []) {
      if (player.isSpectator) continue;
      await roomRepo.updatePlayer(player.id, { status: PLAYER_STATUS.FINISHED });
    }
  }
}

export async function startGame(userId: string, roomId: string, requestId: string) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  if (!player.isHost) throw chessError(CHESS_ERROR.NOT_HOST);
  if (room.status === ROOM_STATUS.PLAYING) throw chessError(CHESS_ERROR.ROOM_ALREADY_PLAYING);
  if (room.status === ROOM_STATUS.CLOSED) throw chessError(CHESS_ERROR.ROOM_CLOSED);

  const contestants = room.players.filter((p) => !p.isSpectator);
  if (contestants.length !== CHESS_MVP.minPlayers) {
    throw chessError(CHESS_ERROR.NOT_ENOUGH_PLAYERS);
  }
  if (contestants.some((p) => p.status !== PLAYER_STATUS.READY)) {
    throw chessError(CHESS_ERROR.NOT_READY);
  }

  const host = contestants.find((p) => p.isHost) ?? player;
  const other = contestants.find((p) => p.id !== host.id);
  if (!other) throw chessError(CHESS_ERROR.NOT_ENOUGH_PLAYERS);

  const sessionRow = await resultRepo.createSession({
    room: { connect: { id: roomId } },
    status: CHESS_GAME_STATUS.INITIALIZING,
    fen: new Chess().fen(),
    pgn: "",
    moves: [],
    whiteTimeMs: room.initialTimeMs,
    blackTimeMs: room.initialTimeMs,
    sequence: 0,
  });

  const started = ChessEngine.start({
    gameId: sessionRow.id,
    roomId,
    white: { playerId: host.id, userId: host.userId },
    black: { playerId: other.id, userId: other.userId },
    requestId,
    initialTimeMs: room.initialTimeMs,
  });

  const session = bindSession({
    roomId,
    gameId: sessionRow.id,
    engine: started.engine,
  });

  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.PLAYING });
  await roomRepo.updatePlayer(host.id, {
    status: PLAYER_STATUS.PLAYING,
    color: CHESS_MVP.hostColor,
  });
  await roomRepo.updatePlayer(other.id, {
    status: PLAYER_STATUS.PLAYING,
    color: "BLACK",
  });
  await persistSession(session);
  startClockLoop(session);
  broadcastEngineResult(session, started);
  const latest = await roomRepo.findRoomById(roomId);
  if (latest) emitRoomUpdated(roomService.toPublicRoom(latest));
  return started;
}

export async function dispatchPlayerAction(
  userId: string,
  roomId: string,
  command: Omit<ChessEngineCommand, "playerId" | "gameId"> & { gameId?: string },
) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  const session = requireSession(roomId);
  if (command.gameId && command.gameId !== session.gameId) {
    throw chessError(CHESS_ERROR.GAME_NOT_FOUND);
  }

  return session.mutex.run(async () => {
    if (!session.engine) throw chessError(CHESS_ERROR.GAME_NOT_STARTED);
    const result = session.engine.apply({
      ...command,
      gameId: session.gameId,
      playerId: player.id,
    });
    if (result.ok) await afterCommit(session, result);
    return result;
  });
}

export async function leaveGame(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);

  const wasPlaying =
    room.status === ROOM_STATUS.PLAYING && !player.isSpectator;
  const next = await roomService.leaveRoom(userId, roomId);
  if (wasPlaying) {
    await onPlayerLeftMidGame(roomId, player.id);
    const latest = await roomRepo.findRoomById(roomId);
    return latest ? roomService.toPublicRoom(latest) : next;
  }
  return next;
}

export async function rematch(userId: string, roomId: string, _requestId: string) {
  const room = await roomRepo.findRoomById(roomId);
  const { player } = requirePlayer(room, userId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  if (!player.isHost) throw chessError(CHESS_ERROR.NOT_HOST);
  if (room.status !== ROOM_STATUS.FINISHED) {
    throw chessError(CHESS_ERROR.GAME_NOT_PLAYING, "Rematch requires a finished game");
  }

  const contestants = room.players.filter(
    (p) =>
      !p.isSpectator &&
      p.connectionStatus !== CONNECTION_STATUS.LEFT &&
      p.connectionStatus !== CONNECTION_STATUS.REMOVED,
  );
  if (contestants.length !== CHESS_MVP.minPlayers) {
    throw chessError(CHESS_ERROR.NOT_ENOUGH_PLAYERS);
  }

  clearGame(roomId);
  for (const p of contestants) {
    await roomRepo.updatePlayer(p.id, {
      status: PLAYER_STATUS.WAITING,
      color: null,
    });
  }
  await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.WAITING });
  const latest = await roomRepo.findRoomById(roomId);
  return latest ? roomService.toPublicRoom(latest) : roomService.toPublicRoom(room);
}

export async function snapshot(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const member = room.players.find((p) => p.userId === userId);
  if (!member) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);
  const publicRoom = roomService.toPublicRoom(room);
  const engine = getSessionByRoom(roomId)?.engine ?? null;
  return {
    sequence: engine?.state.sequence ?? 0,
    serverTime: new Date().toISOString(),
    room: publicRoom,
    game: engine ? engine.publicGame() : null,
  };
}

export async function emitSnapshot(userId: string, roomId: string) {
  const payload = await snapshot(userId, roomId);
  emitSnapshotToUser(userId, payload);
  return payload;
}

export async function abortGame(roomId: string, reason: ChessEndReason) {
  const session = getSessionByRoom(roomId);
  if (!session?.engine) {
    await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.CLOSED });
    return;
  }
  const result = session.engine.apply({
    gameId: session.gameId,
    requestId: `abort:${session.gameId}:${reason}`,
    type: ENGINE_ACTION.ABORT,
    payload: { reason },
  });
  if (result.ok) await afterCommit(session, result);
}

export async function onPlayerLeftMidGame(roomId: string, playerId: string) {
  const session = getSessionByRoom(roomId);
  if (!session?.engine) return;
  const result = session.engine.apply({
    gameId: session.gameId,
    playerId,
    requestId: `leave:${session.gameId}:${playerId}:${session.engine.state.sequence}`,
    type: ENGINE_ACTION.PLAYER_LEFT,
  });
  if (result.ok) await afterCommit(session, result);
}

export async function listHistory(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const member = room.players.find((p) => p.userId === userId);
  if (!member) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);
  const rows = await resultRepo.listResults(roomId);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    pgn: row.pgn,
    fen: row.fen,
    winnerId: row.winnerId,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    endReason: row.session.endReason,
  }));
}

export type { ChessEngineActionType };
