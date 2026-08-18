import { prisma } from "../../../database/prisma.js";

type Db = {
  chessRoom: {
    create: (args: unknown) => Promise<ChessRoomRow>;
    findUnique: (args: unknown) => Promise<ChessRoomRow | null>;
    findFirst: (args: unknown) => Promise<ChessRoomRow | null>;
    update: (args: unknown) => Promise<ChessRoomRow>;
  };
  chessPlayer: {
    create: (args: unknown) => Promise<ChessPlayerRow>;
    update: (args: unknown) => Promise<ChessPlayerRow>;
    delete: (args: unknown) => Promise<ChessPlayerRow>;
    findUnique: (args: unknown) => Promise<ChessPlayerRow | null>;
  };
};

export type ChessPlayerRow = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  isSpectator: boolean;
  color: string | null;
  status: string;
  connectionStatus: string;
  joinedAt: Date;
  user?: { id: string; fullName: string; avatarUrl: string | null } | null;
};

export type ChessRoomRow = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  meetingId: string | null;
  contextType: "MEETING" | "BOARD" | "WORKSPACE";
  hostUserId: string;
  status: "WAITING" | "READY" | "PLAYING" | "FINISHED" | "CLOSED";
  maxPlayers: number;
  allowSpectator: boolean;
  initialTimeMs: number;
  incrementMs: number;
  createdAt: Date;
  updatedAt: Date;
  players: ChessPlayerRow[];
  sessions?: Array<{ id: string; status: string }>;
};

const db = prisma as unknown as Db;

const playerInclude = {
  user: { select: { id: true, fullName: true, avatarUrl: true } },
} as const;

export const roomInclude = {
  players: { include: playerInclude, orderBy: { joinedAt: "asc" as const } },
  sessions: { orderBy: { startedAt: "desc" as const }, take: 1 },
} as const;

export async function createRoom(data: Record<string, unknown>) {
  return db.chessRoom.create({ data, include: roomInclude });
}

export async function findRoomById(roomId: string) {
  return db.chessRoom.findUnique({
    where: { id: roomId },
    include: roomInclude,
  });
}

export async function findActiveRoomForMeeting(meetingId: string) {
  return db.chessRoom.findFirst({
    where: {
      meetingId,
      status: { in: ["WAITING", "READY", "PLAYING", "FINISHED"] },
    },
    orderBy: { createdAt: "desc" },
    include: roomInclude,
  });
}

export async function updateRoom(roomId: string, data: Record<string, unknown>) {
  return db.chessRoom.update({
    where: { id: roomId },
    data,
    include: roomInclude,
  });
}

export async function createPlayer(data: Record<string, unknown>) {
  return db.chessPlayer.create({
    data,
    include: playerInclude,
  });
}

export async function updatePlayer(playerId: string, data: Record<string, unknown>) {
  return db.chessPlayer.update({
    where: { id: playerId },
    data,
    include: playerInclude,
  });
}

export async function deletePlayer(playerId: string) {
  return db.chessPlayer.delete({ where: { id: playerId } });
}

export async function findPlayerByRoomUser(roomId: string, userId: string) {
  return db.chessPlayer.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: playerInclude,
  });
}
