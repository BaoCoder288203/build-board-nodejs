import type { UnoPlayerRow, UnoRoomRow } from "../persistence/uno-room.repository.js";
import { prisma } from "../../../database/prisma.js";
import { getWorkspaceMembership } from "../../../common/access.js";
import {
  CONNECTION_STATUS,
  PLAYER_STATUS,
  ROOM_CONTEXT,
  ROOM_STATUS,
  UNO_MVP,
  type ConnectionStatus,
  type PlayerStatus,
  type RoomStatus,
  type UnoRoomContextType,
} from "../shared/uno.enums.js";
import { UNO_ERROR, unoError } from "../shared/uno.errors.js";
import { DEFAULT_GAME_RULES, type GameRules } from "../game/game.state.js";
import * as roomRepo from "../persistence/uno-room.repository.js";
import type { PublicUnoPlayer, PublicUnoRoom } from "./room.types.js";
import { ensureRuntime } from "../session/game-session.store.js";

export type CreateRoomInput = {
  contextType: UnoRoomContextType;
  meetingId?: string;
  boardId?: string;
  workspaceId?: string;
  maxPlayers?: number;
  allowSpectator?: boolean;
  rules?: Partial<GameRules>;
};

export function mergeRules(input?: Partial<GameRules>): GameRules {
  const rules = { ...DEFAULT_GAME_RULES, ...input };
  if (rules.stacking || rules.jumpIn || rules.sevenZero) {
    throw unoError(
      UNO_ERROR.UNSUPPORTED_RULE,
      "stacking, jump-in, and seven-o are not available in MVP",
    );
  }
  return rules;
}

function asStatus(value: string): PlayerStatus {
  return value as PlayerStatus;
}

function asConn(value: string): ConnectionStatus {
  return value as ConnectionStatus;
}

export function toPublicPlayer(player: {
  id: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  isSpectator: boolean;
  status: string;
  connectionStatus: string;
  seatIndex: number | null;
  joinedAt: Date;
  user?: { avatarUrl: string | null } | null;
}): PublicUnoPlayer {
  return {
    playerId: player.id,
    userId: player.userId,
    displayName: player.displayName,
    avatarUrl: player.user?.avatarUrl ?? null,
    isHost: player.isHost,
    isSpectator: player.isSpectator,
    isReady: player.status === PLAYER_STATUS.READY,
    status: asStatus(player.status),
    connectionStatus: asConn(player.connectionStatus),
    seatIndex: player.seatIndex,
    joinedAt: player.joinedAt.toISOString(),
  };
}

export function toPublicRoom(room: UnoRoomRow): PublicUnoRoom {
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
    rules: room.rules as GameRules,
    players: room.players.map(toPublicPlayer),
    gameId: active?.id ?? room.sessions?.[0]?.id ?? null,
    createdAt: room.createdAt.toISOString(),
  };
}

function lobbyStatus(players: Array<{ status: string; isSpectator: boolean }>): RoomStatus {
  const active = players.filter((p) => !p.isSpectator && p.status !== PLAYER_STATUS.SPECTATING);
  if (active.length < UNO_MVP.minPlayers) return ROOM_STATUS.WAITING;
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
  if (!meeting) throw unoError(UNO_ERROR.MEETING_ACCESS_DENIED);
  const inCall = meeting.participants.some((p) => p.userId === userId);
  if (!inCall && meeting.status === "ACTIVE") {
    throw unoError(UNO_ERROR.MEETING_REQUIRED);
  }
  return meeting;
}

export async function createRoom(userId: string, input: CreateRoomInput) {
  const rules = mergeRules(input.rules);
  const maxPlayers = Math.min(
    UNO_MVP.maxPlayers,
    Math.max(UNO_MVP.minPlayers, input.maxPlayers ?? UNO_MVP.maxPlayers),
  );

  let workspaceId = input.workspaceId;
  let boardId = input.boardId ?? null;
  let meetingId = input.meetingId ?? null;
  const contextType = input.contextType;

  if (contextType === ROOM_CONTEXT.MEETING) {
    if (!meetingId) throw unoError(UNO_ERROR.MEETING_REQUIRED);
    const meeting = await assertMeetingParticipant(userId, meetingId);
    workspaceId = meeting.workspaceId;
    boardId = meeting.boardId;
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
  } else if (contextType === ROOM_CONTEXT.BOARD) {
    if (!boardId) throw unoError(UNO_ERROR.FORBIDDEN, "boardId required");
    const board = await prisma.board.findFirst({
      where: { id: boardId, deletedAt: null },
      include: { project: { select: { workspaceId: true } } },
    });
    if (!board) throw unoError(UNO_ERROR.FORBIDDEN);
    workspaceId = board.project.workspaceId;
  }

  if (!workspaceId) throw unoError(UNO_ERROR.FORBIDDEN, "workspaceId required");
  await getWorkspaceMembership(userId, workspaceId);

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unoError(UNO_ERROR.UNAUTHENTICATED);

  const room = await roomRepo.createRoom({
    workspace: { connect: { id: workspaceId } },
    board: boardId ? { connect: { id: boardId } } : undefined,
    meeting: meetingId ? { connect: { id: meetingId } } : undefined,
    host: { connect: { id: userId } },
    contextType,
    maxPlayers,
    allowSpectator: input.allowSpectator ?? true,
    rules,
    status: ROOM_STATUS.WAITING,
    players: {
      create: {
        user: { connect: { id: userId } },
        displayName: user.fullName,
        isHost: true,
        isSpectator: false,
        status: PLAYER_STATUS.WAITING,
        connectionStatus: CONNECTION_STATUS.CONNECTED,
        seatIndex: 0,
      },
    },
  });

  ensureRuntime(room.id);
  return toPublicRoom(room);
}

export async function getRoom(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  await getWorkspaceMembership(userId, room.workspaceId);
  return toPublicRoom(room);
}

export async function joinRoom(
  userId: string,
  roomId: string,
  input: { asSpectator?: boolean },
) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  if (room.status === ROOM_STATUS.CLOSED) throw unoError(UNO_ERROR.ROOM_CLOSED);
  await getWorkspaceMembership(userId, room.workspaceId);

  const existing = room.players.find((p) => p.userId === userId);
  if (existing) {
    if (existing.connectionStatus === CONNECTION_STATUS.LEFT) {
      throw unoError(UNO_ERROR.ALREADY_IN_ROOM);
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
    throw unoError(UNO_ERROR.ROOM_ALREADY_PLAYING);
  }

  if (room.contextType === ROOM_CONTEXT.MEETING && room.meetingId) {
    const runtime = ensureRuntime(roomId);
    const meeting = await prisma.meeting.findFirst({
      where: { id: room.meetingId },
      include: { participants: { where: { leftAt: null }, select: { userId: true } } },
    });
    const inCall = meeting?.participants.some((p) => p.userId === userId) ?? false;
    const invited = runtime.invitedUserIds.has(userId);
    if (!inCall && !invited) throw unoError(UNO_ERROR.MEETING_REQUIRED);
  }

  const asSpectator = Boolean(input.asSpectator);
  if (!asSpectator) {
    const playerCount = room.players.filter((p) => !p.isSpectator).length;
    if (playerCount >= room.maxPlayers) throw unoError(UNO_ERROR.ROOM_FULL);
  } else if (!room.allowSpectator) {
    throw unoError(UNO_ERROR.FORBIDDEN, "Spectators are not allowed");
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unoError(UNO_ERROR.UNAUTHENTICATED);

  const player = await roomRepo.createPlayer({
    room: { connect: { id: roomId } },
    user: { connect: { id: userId } },
    displayName: user.fullName,
    isHost: false,
    isSpectator: asSpectator,
    status: asSpectator ? PLAYER_STATUS.SPECTATING : PLAYER_STATUS.WAITING,
    connectionStatus: CONNECTION_STATUS.CONNECTED,
    seatIndex: asSpectator ? null : room.players.filter((p) => !p.isSpectator).length,
  });

  const refreshed = await roomRepo.findRoomById(roomId);
  if (refreshed && refreshed.status !== ROOM_STATUS.PLAYING) {
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
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw unoError(UNO_ERROR.NOT_ROOM_MEMBER);

  const remaining = room.players.filter((p) => p.userId !== userId && p.connectionStatus !== CONNECTION_STATUS.LEFT);

  if (room.status === ROOM_STATUS.PLAYING) {
    await roomRepo.updatePlayer(player.id, {
      connectionStatus: CONNECTION_STATUS.LEFT,
    });
  } else {
    await roomRepo.deletePlayer(player.id);
  }

  if (player.isHost && remaining.length > 0) {
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
  } else if (room.status !== ROOM_STATUS.PLAYING && room.status !== ROOM_STATUS.CLOSED) {
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
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  if (room.status === ROOM_STATUS.PLAYING) throw unoError(UNO_ERROR.ROOM_ALREADY_PLAYING);
  if (room.status === ROOM_STATUS.CLOSED) throw unoError(UNO_ERROR.ROOM_CLOSED);
  const player = room.players.find((p) => p.userId === userId);
  if (!player) throw unoError(UNO_ERROR.NOT_ROOM_MEMBER);
  if (player.isSpectator) throw unoError(UNO_ERROR.SPECTATOR_ACTION_DENIED);

  await roomRepo.updatePlayer(player.id, {
    status: ready ? PLAYER_STATUS.READY : PLAYER_STATUS.WAITING,
  });
  const latest = await roomRepo.findRoomById(roomId);
  if (!latest) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const status = lobbyStatus(latest.players);
  if (status !== latest.status) {
    await roomRepo.updateRoom(roomId, { status });
  }
  const refreshed = await roomRepo.findRoomById(roomId);
  return refreshed ? toPublicRoom(refreshed) : toPublicRoom(latest);
}

export async function invitePlayers(userId: string, roomId: string, userIds: string[]) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const host = room.players.find((p) => p.userId === userId);
  if (!host?.isHost) throw unoError(UNO_ERROR.NOT_HOST);
  const runtime = ensureRuntime(roomId);
  for (const id of userIds) runtime.invitedUserIds.add(id);
  return { room: toPublicRoom(room), invitedUserIds: userIds };
}

export async function kickPlayer(userId: string, roomId: string, playerId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  const host = room.players.find((p) => p.userId === userId);
  if (!host?.isHost) throw unoError(UNO_ERROR.NOT_HOST);
  const target = room.players.find((p) => p.id === playerId);
  if (!target) throw unoError(UNO_ERROR.NOT_ROOM_MEMBER);
  if (target.isHost) throw unoError(UNO_ERROR.FORBIDDEN, "Cannot kick the host");

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

export async function transferHostIfNeeded(roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) return null;
  const host = room.players.find((p) => p.isHost);
  if (!host) return toPublicRoom(room);
  if (host.connectionStatus === CONNECTION_STATUS.CONNECTED) return toPublicRoom(room);
  const next = room.players
    .filter(
      (p) =>
        !p.isHost &&
        !p.isSpectator &&
        p.connectionStatus === CONNECTION_STATUS.CONNECTED,
    )
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
  if (!next) return toPublicRoom(room);
  await roomRepo.updatePlayer(host.id, { isHost: false });
  await roomRepo.updatePlayer(next.id, { isHost: true });
  await roomRepo.updateRoom(roomId, { host: { connect: { id: next.userId } } });
  const latest = await roomRepo.findRoomById(roomId);
  return latest ? toPublicRoom(latest) : toPublicRoom(room);
}

export { lobbyStatus };
