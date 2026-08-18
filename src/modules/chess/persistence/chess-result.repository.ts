import { prisma } from "../../../database/prisma.js";

type SessionRow = {
  id: string;
  roomId: string;
  status: string;
  fen: string;
  pgn: string;
  moves: unknown;
  whiteTimeMs: number;
  blackTimeMs: number;
  sequence: number;
  winnerId: string | null;
  endReason: string | null;
  startedAt: Date;
  endedAt: Date | null;
};

type ResultRow = {
  id: string;
  sessionId: string;
  pgn: string;
  fen: string;
  winnerId: string | null;
  reason: string;
  createdAt: Date;
  session: SessionRow;
};

const db = prisma as unknown as {
  chessGameSession: {
    create: (args: unknown) => Promise<SessionRow>;
    update: (args: unknown) => Promise<SessionRow>;
    findFirst: (args: unknown) => Promise<SessionRow | null>;
  };
  chessGameResult: {
    create: (args: unknown) => Promise<ResultRow>;
    findMany: (args: unknown) => Promise<ResultRow[]>;
  };
};

export async function createSession(data: Record<string, unknown>) {
  return db.chessGameSession.create({ data });
}

export async function updateSession(sessionId: string, data: Record<string, unknown>) {
  return db.chessGameSession.update({ where: { id: sessionId }, data });
}

export async function createResult(data: Record<string, unknown>) {
  return db.chessGameResult.create({ data });
}

export async function listResults(roomId: string) {
  return db.chessGameResult.findMany({
    where: { session: { roomId } },
    orderBy: { createdAt: "desc" },
    include: { session: true },
  });
}

export async function findLatestSession(roomId: string) {
  return db.chessGameSession.findFirst({
    where: { roomId },
    orderBy: { startedAt: "desc" },
  });
}
