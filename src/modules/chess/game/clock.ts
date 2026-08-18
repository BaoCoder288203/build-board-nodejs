import { CHESS_MVP, type ChessColor } from "../shared/chess.enums.js";

export type ChessClocks = {
  whiteTimeMs: number;
  blackTimeMs: number;
  runningColor: ChessColor | null;
  lastStartedAt: number | null;
};

export function createClocks(now: number, initialTimeMs = CHESS_MVP.initialTimeMs): ChessClocks {
  return {
    whiteTimeMs: initialTimeMs,
    blackTimeMs: initialTimeMs,
    runningColor: "WHITE",
    lastStartedAt: now,
  };
}

export function remainingMs(clocks: ChessClocks, color: ChessColor, now: number): number {
  const stored = color === "WHITE" ? clocks.whiteTimeMs : clocks.blackTimeMs;
  if (clocks.runningColor !== color || clocks.lastStartedAt == null) return stored;
  return Math.max(0, stored - (now - clocks.lastStartedAt));
}

export function settleClocks(clocks: ChessClocks, now: number): ChessClocks {
  return {
    whiteTimeMs: remainingMs(clocks, "WHITE", now),
    blackTimeMs: remainingMs(clocks, "BLACK", now),
    runningColor: clocks.runningColor,
    lastStartedAt: clocks.runningColor ? now : null,
  };
}

export function afterMove(
  clocks: ChessClocks,
  movedColor: ChessColor,
  now: number,
  incrementMs = CHESS_MVP.incrementMs,
): ChessClocks {
  const settled = settleClocks(clocks, now);
  const key = movedColor === "WHITE" ? "whiteTimeMs" : "blackTimeMs";
  return {
    whiteTimeMs: settled.whiteTimeMs,
    blackTimeMs: settled.blackTimeMs,
    [key]: settled[key] + incrementMs,
    runningColor: movedColor === "WHITE" ? "BLACK" : "WHITE",
    lastStartedAt: now,
  };
}

export function stopClocks(clocks: ChessClocks, now: number): ChessClocks {
  return {
    whiteTimeMs: remainingMs(clocks, "WHITE", now),
    blackTimeMs: remainingMs(clocks, "BLACK", now),
    runningColor: null,
    lastStartedAt: null,
  };
}

export function timedOutColor(clocks: ChessClocks, now: number): ChessColor | null {
  if (clocks.runningColor == null) return null;
  if (remainingMs(clocks, clocks.runningColor, now) <= 0) return clocks.runningColor;
  return null;
}

export function clockSyncPayload(clocks: ChessClocks, now: number, sequence: number) {
  const settled = settleClocks(clocks, now);
  return {
    whiteTimeMs: settled.whiteTimeMs,
    blackTimeMs: settled.blackTimeMs,
    runningColor: settled.runningColor,
    serverTime: new Date(now).toISOString(),
    sequence,
  };
}
