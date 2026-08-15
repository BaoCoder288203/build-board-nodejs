import { GameEngine } from "../game/game.engine.js";
import type { UnoGameState } from "../game/game.state.js";

class AsyncMutex {
  private locked = false;
  private readonly waiters: Array<() => void> = [];

  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire() {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release() {
    const next = this.waiters.shift();
    if (next) next();
    else this.locked = false;
  }
}

export type RuntimeSession = {
  roomId: string;
  gameId: string;
  engine: GameEngine;
  mutex: AsyncMutex;
  socketsByUserId: Map<string, Set<string>>;
  invitedUserIds: Set<string>;
  disconnectTimers: Map<string, ReturnType<typeof setTimeout>>;
  challengeTimer: ReturnType<typeof setTimeout> | null;
  unoWindowTimer: ReturnType<typeof setTimeout> | null;
};

const sessionsByRoom = new Map<string, RuntimeSession>();
const sessionsByGame = new Map<string, RuntimeSession>();
const roomMutexes = new Map<string, AsyncMutex>();

export function roomMutex(roomId: string) {
  const existing = roomMutexes.get(roomId);
  if (existing) return existing;
  const mutex = new AsyncMutex();
  roomMutexes.set(roomId, mutex);
  return mutex;
}

export function getSessionByRoom(roomId: string) {
  return sessionsByRoom.get(roomId) ?? null;
}

export function getSessionByGame(gameId: string) {
  return sessionsByGame.get(gameId) ?? null;
}

export function bindSession(input: {
  roomId: string;
  gameId: string;
  engine: GameEngine;
}) {
  const prev = sessionsByRoom.get(input.roomId);
  if (prev?.challengeTimer) clearTimeout(prev.challengeTimer);
  if (prev?.unoWindowTimer) clearTimeout(prev.unoWindowTimer);

  const session: RuntimeSession = {
    roomId: input.roomId,
    gameId: input.gameId,
    engine: input.engine,
    mutex: new AsyncMutex(),
    socketsByUserId: prev?.socketsByUserId ?? new Map(),
    invitedUserIds: prev?.invitedUserIds ?? new Set(),
    disconnectTimers: prev?.disconnectTimers ?? new Map(),
    challengeTimer: null,
    unoWindowTimer: null,
  };
  sessionsByRoom.set(input.roomId, session);
  sessionsByGame.set(input.gameId, session);
  return session;
}

export function ensureRuntime(roomId: string) {
  const existing = sessionsByRoom.get(roomId);
  if (existing) return existing;
  const session: RuntimeSession = {
    roomId,
    gameId: "",
    engine: new GameEngine(),
    mutex: new AsyncMutex(),
    socketsByUserId: new Map(),
    invitedUserIds: new Set(),
    disconnectTimers: new Map(),
    challengeTimer: null,
    unoWindowTimer: null,
  };
  sessionsByRoom.set(roomId, session);
  return session;
}

export function attachSocket(roomId: string, userId: string, socketId: string) {
  const runtime = ensureRuntime(roomId);
  const set = runtime.socketsByUserId.get(userId) ?? new Set();
  set.add(socketId);
  runtime.socketsByUserId.set(userId, set);
  const timer = runtime.disconnectTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    runtime.disconnectTimers.delete(userId);
  }
  return runtime;
}

export function detachSocket(roomId: string, userId: string, socketId: string) {
  const runtime = sessionsByRoom.get(roomId);
  if (!runtime) return { remaining: 0, runtime: null };
  const set = runtime.socketsByUserId.get(userId);
  set?.delete(socketId);
  const remaining = set?.size ?? 0;
  if (remaining === 0) runtime.socketsByUserId.delete(userId);
  return { remaining, runtime };
}

export function getState(roomId: string): UnoGameState | null {
  return sessionsByRoom.get(roomId)?.engine.state ?? null;
}

export function clearGame(roomId: string) {
  const runtime = sessionsByRoom.get(roomId);
  if (!runtime) return;
  if (runtime.challengeTimer) clearTimeout(runtime.challengeTimer);
  if (runtime.unoWindowTimer) clearTimeout(runtime.unoWindowTimer);
  if (runtime.gameId) sessionsByGame.delete(runtime.gameId);
  runtime.engine = new GameEngine();
  runtime.gameId = "";
  runtime.challengeTimer = null;
  runtime.unoWindowTimer = null;
}
