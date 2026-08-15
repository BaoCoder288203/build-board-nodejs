import { prisma } from "../../../database/prisma.js";

type Db = {
  unoRoom: {
    create: (args: unknown) => Promise<UnoRoomRow>;
    findUnique: (args: unknown) => Promise<UnoRoomRow | null>;
    findFirst: (args: unknown) => Promise<UnoRoomRow | null>;
    update: (args: unknown) => Promise<UnoRoomRow>;
  };
  unoPlayer: {
    create: (args: unknown) => Promise<UnoPlayerRow>;
    update: (args: unknown) => Promise<UnoPlayerRow>;
    delete: (args: unknown) => Promise<UnoPlayerRow>;
    findUnique: (args: unknown) => Promise<UnoPlayerRow | null>;
  };
};

export type UnoPlayerRow = {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  isHost: boolean;
  isSpectator: boolean;
  status: string;
  connectionStatus: string;
  seatIndex: number | null;
  joinedAt: Date;
  user?: { id: string; fullName: string; avatarUrl: string | null } | null;
};

export type UnoRoomRow = {
  id: string;
  workspaceId: string;
  boardId: string | null;
  meetingId: string | null;
  contextType: "MEETING" | "BOARD" | "WORKSPACE";
  hostUserId: string;
  status: "WAITING" | "READY" | "PLAYING" | "FINISHED" | "CLOSED";
  maxPlayers: number;
  allowSpectator: boolean;
  rules: unknown;
  createdAt: Date;
  updatedAt: Date;
  players: UnoPlayerRow[];
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
  return db.unoRoom.create({ data, include: roomInclude });
}

export async function findRoomById(roomId: string) {
  return db.unoRoom.findUnique({
    where: { id: roomId },
    include: roomInclude,
  });
}

export async function findActiveRoomForMeeting(meetingId: string) {
  return db.unoRoom.findFirst({
    where: {
      meetingId,
      status: { in: ["WAITING", "READY", "PLAYING", "FINISHED"] },
    },
    orderBy: { createdAt: "desc" },
    include: roomInclude,
  });
}

export async function updateRoom(roomId: string, data: Record<string, unknown>) {
  return db.unoRoom.update({
    where: { id: roomId },
    data,
    include: roomInclude,
  });
}

export async function createPlayer(data: Record<string, unknown>) {
  return db.unoPlayer.create({
    data,
    include: playerInclude,
  });
}

export async function updatePlayer(playerId: string, data: Record<string, unknown>) {
  return db.unoPlayer.update({
    where: { id: playerId },
    data,
    include: playerInclude,
  });
}

export async function deletePlayer(playerId: string) {
  return db.unoPlayer.delete({ where: { id: playerId } });
}

export async function findPlayerByRoomUser(roomId: string, userId: string) {
  return db.unoPlayer.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: playerInclude,
  });
}
