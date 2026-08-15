import { prisma } from "../../../database/prisma.js";

type SessionRow = {
  id: string;
  roomId: string;
  status: string;
  roundNumber: number;
  sequence: number;
  scores: unknown;
  rules: unknown;
  startedAt: Date;
  endedAt: Date | null;
  winnerId: string | null;
  endReason: string | null;
};

type ResultRow = {
  id: string;
  sessionId: string;
  scores: unknown;
  winnerId: string | null;
  createdAt: Date;
  session: SessionRow;
};

const db = prisma as unknown as {
  unoGameSession: {
    create: (args: unknown) => Promise<SessionRow>;
    update: (args: unknown) => Promise<SessionRow>;
    findFirst: (args: unknown) => Promise<SessionRow | null>;
  };
  unoGameResult: {
    create: (args: unknown) => Promise<ResultRow>;
    findMany: (args: unknown) => Promise<ResultRow[]>;
  };
};

export async function createSession(data: Record<string, unknown>) {
  return db.unoGameSession.create({ data });
}

export async function updateSession(sessionId: string, data: Record<string, unknown>) {
  return db.unoGameSession.update({ where: { id: sessionId }, data });
}

export async function createResult(data: Record<string, unknown>) {
  return db.unoGameResult.create({ data });
}

export async function listResults(roomId: string) {
  return db.unoGameResult.findMany({
    where: { session: { roomId } },
    orderBy: { createdAt: "desc" },
    include: { session: true },
  });
}

export async function findLatestSession(roomId: string) {
  return db.unoGameSession.findFirst({
    where: { roomId },
    orderBy: { startedAt: "desc" },
  });
}
