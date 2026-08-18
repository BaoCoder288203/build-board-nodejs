import { ChessEngine } from "../game/chess-engine.js";

export function startTwoPlayer(options?: { now?: number; initialTimeMs?: number }) {
  const now = options?.now ?? Date.now();
  const started = ChessEngine.start({
    gameId: "game-1",
    roomId: "room-1",
    white: { playerId: "p-white", userId: "u-white" },
    black: { playerId: "p-black", userId: "u-black" },
    requestId: "start-1",
    now,
    initialTimeMs: options?.initialTimeMs,
  });
  return {
    engine: started.engine,
    state: started.engine.state,
    white: "p-white",
    black: "p-black",
    now,
  };
}
