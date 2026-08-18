import { prisma } from "../../../database/prisma.js";
import { getWorkspaceMembership } from "../../../common/access.js";
import {
  CHESS_MVP,
  CONNECTION_STATUS,
  PLAYER_STATUS,
  ROOM_CONTEXT,
  ROOM_STATUS,
  type ChessColor,
  type ConnectionStatus,
  type PlayerStatus,
  type RoomStatus,
  type ChessContextType,
} from "../shared/chess.enums.js";
import { CHESS_ERROR, chessError } from "../shared/chess.errors.js";
import * as roomRepo from "../persistence/chess-room.repository.js";
import type { ChessPlayerRow, ChessRoomRow } from "../persistence/chess-room.repository.js";
import type { PublicChessPlayer, PublicChessRoom } from "./room.types.js";
import { ensureRuntime } from "../session/chess-session.store.js";

export type CreateRoomInput = {
  contextType: ChessContextType;
  meetingId?: string;
  boardId?: string;
  workspaceId?: string;
  allowSpectator?: boolean;
};

function asStatus(value: string): PlayerStatus {
  return value as PlayerStatus;
}

function asConn(value: string): ConnectionStatus {
  return value as ConnectionStatus;
}

function asColor(value: string | null): ChessColor | null {
  if (value === "WHITE" || value === "BLACK") return value;
  return null;
}

export function toPublicPlayer(player: {
  id: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  isSpectator: boolean;
  color: string | null;
  status: string;
  connectionStatus: string;
  joinedAt: Date;
  user?: { avatarUrl: string | null } | null;
}): PublicChessPlayer {
  return {
    playerId: player.id,
    userId: player.userId,
    displayName: player.displayName,
    avatarUrl: player.user?.avatarUrl ?? null,
    isHost: player.isHost,
    isSpectator: player.isSpectator,
    isReady: player.status === PLAYER_STATUS.READY,
    color: asColor(player.color),
    status: asStatus(player.status),
    connectionStatus: asConn(player.connectionStatus),
    joinedAt: player.joinedAt.toISOString(),
  };
}

export function toPublicRoom(room: ChessRoomRow): PublicChessRoom {
  const active = room.sessions?.find(
    (s) => s.status !== "FINISHED" && s.status !== "ABORTED",
  );
  const hostPlayer = room.players.find((p) => p.isHost);
  return {
    id: room.id,
    status: room.status as RoomStatus,
    hostId: hostPlayer?.id ?? room.hostUserId,
    hostUserId: room.hostUserId,
    contextType: room.contextType,
    meetingId: room.meetingId,
    boardId: room.boardId,
    workspaceId: room.workspaceId,
    maxPlayers: room.maxPlayers,
    allowSpectator: room.allowSpectator,
    initialTimeMs: room.initialTimeMs,
    incrementMs: room.incrementMs,
    players: room.players.map(toPublicPlayer),
    gameId: active?.id ?? room.sessions?.[0]?.id ?? null,
    createdAt: room.createdAt.toISOString(),
  };
}

export function lobbyStatus(
  players: Array<{ status: string; isSpectator: boolean }>,
): RoomStatus {
  const active = players.filter(
    (p) => !p.isSpectator && p.status !== PLAYER_STATUS.SPECTATING,
  );
  if (active.length !== CHESS_MVP.minPlayers) return ROOM_STATUS.WAITING;
  const allReady = active.every((p) => p.status === PLAYER_STATUS.READY);
  return allReady ? ROOM_STATUS.READY : ROOM_STATUS.WAITING;
}

async function assertMeetingParticipant(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId },
    include: {
      participants: {
        where: { leftAt: null },
        select: { userId: true },
      },
    },
  });
  if (!meeting) throw chessError(CHESS_ERROR.MEETING_ACCESS_DENIED);
  const inCall = meeting.participants.some((p) => p.userId === userId);
  if (!inCall && meeting.status === "ACTIVE") {
    throw chessError(CHESS_ERROR.MEETING_REQUIRED);
  }
  return meeting;
}

export async function createRoom(userId: string, input: CreateRoomInput) {
  if (input.contextType !== ROOM_CONTEXT.MEETING) {
    throw chessError(CHESS_ERROR.MEETING_REQUIRED);
  }
  if (!input.meetingId) throw chessError(CHESS_ERROR.MEETING_REQUIRED);

  const meeting = await assertMeetingParticipant(userId, input.meetingId);
  const workspaceId = meeting.workspaceId;
  const boardId = meeting.boardId;
  const meetingId = input.meetingId;

  const existing = await roomRepo.findActiveRoomForMeeting(meetingId);
  if (existing && existing.status !== ROOM_STATUS.CLOSED) {
    const already = existing.players.some((p) => p.userId === userId);
    if (!already) {
      await joinRoom(userId, existing.id, { asSpectator: false });
      const refreshed = await roomRepo.findRoomById(existing.id);
      if (refreshed) return toPublicRoom(refreshed);
    }
    return toPublicRoom(existing);
  }

  await getWorkspaceMembership(userId, workspaceId);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw chessError(CHESS_ERROR.UNAUTHENTICATED);

  const room = await roomRepo.createRoom({
    workspace: { connect: { id: workspaceId } },
    board: boardId ? { connect: { id: boardId } } : undefined,
    meeting: { connect: { id: meetingId } },
    host: { connect: { id: userId } },
    contextType: ROOM_CONTEXT.MEETING,
    maxPlayers: CHESS_MVP.maxPlayers,
    allowSpectator: input.allowSpectator ?? CHESS_MVP.allowSpectator,
    initialTimeMs: CHESS_MVP.initialTimeMs,
    incrementMs: CHESS_MVP.incrementMs,
    status: ROOM_STATUS.WAITING,
    players: {
      create: {
        user: { connect: { id: userId } },
        displayName: user.fullName,
        isHost: true,
        isSpectator: false,
        status: PLAYER_STATUS.WAITING,
        connectionStatus: CONNECTION_STATUS.CONNECTED,
      },
    },
  });

  ensureRuntime(room.id);
  return toPublicRoom(room);
}

export async function getRoom(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  await getWorkspaceMembership(userId, room.workspaceId);
  return toPublicRoom(room);
}

export async function joinRoom(
  userId: string,
  roomId: string,
  input: { asSpectator?: boolean },
) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  if (room.status === ROOM_STATUS.CLOSED) throw chessError(CHESS_ERROR.ROOM_CLOSED);
  await getWorkspaceMembership(userId, room.workspaceId);

  const existing = room.players.find((p) => p.userId === userId);
  if (existing) {
    if (existing.connectionStatus === CONNECTION_STATUS.LEFT) {
      throw chessError(CHESS_ERROR.ALREADY_IN_ROOM);
    }
    const updated = await roomRepo.updatePlayer(existing.id, {
      connectionStatus: CONNECTION_STATUS.CONNECTED,
    });
    const refreshed = await roomRepo.findRoomById(roomId);
    return {
      room: refreshed ? toPublicRoom(refreshed) : toPublicRoom(room),
      player: toPublicPlayer(updated),
      reconnected: true,
    };
  }

  if (room.status === ROOM_STATUS.PLAYING && !input.asSpectator) {
    throw chessError(CHESS_ERROR.ROOM_ALREADY_PLAYING);
  }

  if (room.contextType === ROOM_CONTEXT.MEETING && room.meetingId) {
    const runtime = ensureRuntime(roomId);
    const meeting = await prisma.meeting.findFirst({
      where: { id: room.meetingId },
      include: { participants: { where: { leftAt: null }, select: { userId: true } } },
    });
    const inCall = meeting?.participants.some((p) => p.userId === userId) ?? false;
    const invited = runtime.invitedUserIds.has(userId);
    if (!inCall && !invited) throw chessError(CHESS_ERROR.MEETING_REQUIRED);
  }

  const asSpectator = Boolean(input.asSpectator);
  if (!asSpectator) {
    const playerCount = room.players.filter((p) => !p.isSpectator).length;
    if (playerCount >= room.maxPlayers) throw chessError(CHESS_ERROR.ROOM_FULL);
  } else if (!room.allowSpectator) {
    throw chessError(CHESS_ERROR.FORBIDDEN, "Spectators are not allowed");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw chessError(CHESS_ERROR.UNAUTHENTICATED);

  const player = await roomRepo.createPlayer({
    room: { connect: { id: roomId } },
    user: { connect: { id: userId } },
    displayName: user.fullName,
    isHost: false,
    isSpectator: asSpectator,
    status: asSpectator ? PLAYER_STATUS.SPECTATING : PLAYER_STATUS.WAITING,
    connectionStatus: CONNECTION_STATUS.CONNECTED,
  });

  const refreshed = await roomRepo.findRoomById(roomId);
  if (refreshed && refreshed.status !== ROOM_STATUS.PLAYING && refreshed.status !== ROOM_STATUS.FINISHED) {
    const next = lobbyStatus(refreshed.players);
    if (next !== refreshed.status) {
      await roomRepo.updateRoom(roomId, { status: next });
    }
  }
  const latest = await roomRepo.findRoomById(roomId);
  return {
    room: latest ? toPublicRoom(latest) : toPublicRoom(room),
    player: toPublicPlayer(player),
    reconnected: false,
  };
}

export async function leaveRoom(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);

  const remaining = room.players.filter(
    (p) => p.userId !== userId && p.connectionStatus !== CONNECTION_STATUS.LEFT,
  );

  if (room.status === ROOM_STATUS.PLAYING) {
    await roomRepo.updatePlayer(player.id, {
      connectionStatus: CONNECTION_STATUS.LEFT,
    });
  } else {
    await roomRepo.deletePlayer(player.id);
  }

  if (player.isHost && remaining.length > 0 && room.status !== ROOM_STATUS.PLAYING) {
    const nextHost = [...remaining].sort(
      (a, b) => a.joinedAt.getTime() - b.joinedAt.getTime(),
    )[0];
    if (nextHost) {
      await roomRepo.updatePlayer(nextHost.id, { isHost: true });
      await roomRepo.updateRoom(roomId, { host: { connect: { id: nextHost.userId } } });
    }
  }

  if (remaining.length === 0) {
    await roomRepo.updateRoom(roomId, { status: ROOM_STATUS.CLOSED });
  } else if (room.status !== ROOM_STATUS.PLAYING && room.status !== ROOM_STATUS.CLOSED && room.status !== ROOM_STATUS.FINISHED) {
    const latest = await roomRepo.findRoomById(roomId);
    if (latest) {
      await roomRepo.updateRoom(roomId, { status: lobbyStatus(latest.players) });
    }
  }

  const latest = await roomRepo.findRoomById(roomId);
  return latest ? toPublicRoom(latest) : toPublicRoom(room);
}

export async function setReady(userId: string, roomId: string, ready: boolean) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  if (room.status === ROOM_STATUS.PLAYING) throw chessError(CHESS_ERROR.ROOM_ALREADY_PLAYING);
  if (room.status === ROOM_STATUS.CLOSED) throw chessError(CHESS_ERROR.ROOM_CLOSED);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);
  if (player.isSpectator) throw chessError(CHESS_ERROR.SPECTATOR_ACTION_DENIED);

  await roomRepo.updatePlayer(player.id, {
    status: ready ? PLAYER_STATUS.READY : PLAYER_STATUS.WAITING,
  });
  const latest = await roomRepo.findRoomById(roomId);
  if (!latest) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const status = lobbyStatus(latest.players);
  if (status !== latest.status) {
    await roomRepo.updateRoom(roomId, { status });
  }
  const refreshed = await roomRepo.findRoomById(roomId);
  return refreshed ? toPublicRoom(refreshed) : toPublicRoom(latest);
}

export async function invitePlayers(userId: string, roomId: string, userIds: string[]) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const host = room.players.find((p) => p.userId === userId);
  if (!host?.isHost) throw chessError(CHESS_ERROR.NOT_HOST);
  const runtime = ensureRuntime(roomId);
  for (const id of userIds) runtime.invitedUserIds.add(id);
  return { room: toPublicRoom(room), invitedUserIds: userIds };
}

export async function kickPlayer(userId: string, roomId: string, playerId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw chessError(CHESS_ERROR.ROOM_NOT_FOUND);
  const host = room.players.find((p) => p.userId === userId);
  if (!host?.isHost) throw chessError(CHESS_ERROR.NOT_HOST);
  const target = room.players.find((p) => p.id === playerId);
  if (!target) throw chessError(CHESS_ERROR.NOT_ROOM_MEMBER);
  if (target.isHost) throw chessError(CHESS_ERROR.FORBIDDEN, "Cannot kick the host");

  if (room.status === ROOM_STATUS.PLAYING) {
    await roomRepo.updatePlayer(target.id, {
      connectionStatus: CONNECTION_STATUS.REMOVED,
    });
  } else {
    await roomRepo.deletePlayer(target.id);
  }
  const latest = await roomRepo.findRoomById(roomId);
  return latest ? toPublicRoom(latest) : toPublicRoom(room);
}

export async function markConnection(
  roomId: string,
  userId: string,
  connectionStatus: ConnectionStatus,
) {
  const player = await roomRepo.findPlayerByRoomUser(roomId, userId);
  if (!player) return null;
  return roomRepo.updatePlayer(player.id, { connectionStatus });
}

export type { ChessPlayerRow, ChessRoomRow };
