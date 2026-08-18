import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess end conditions", () => {
  it("detects checkmate", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("7k/5Q2/6K1/8/8/8/8/8 w - - 0 1");
    const result = engine.apply({
      requestId: "mate",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "f7", to: "f8" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.status, "FINISHED");
    assert.equal(result.state.endReason, "CHECKMATE");
    assert.equal(result.state.winnerColor, "WHITE");
  });

  it("detects stalemate as a draw", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("k7/8/1Q6/8/8/8/8/4K3 w - - 0 1");
    const result = engine.apply({
      requestId: "stale",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "b6", to: "c7" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.status, "FINISHED");
    assert.equal(result.state.endReason, "STALEMATE");
    assert.equal(result.state.winnerColor, null);
  });

  it("flags timeout vs king-only as TIMEOUT_VS_INSUFFICIENT", () => {
    const now = 5_000_000;
    const { engine } = startTwoPlayer({ now, initialTimeMs: 1000 });
    engine.chess.load("8/8/8/8/8/8/8/K6k w - - 0 1");
    engine.state.clocks.whiteTimeMs = 0;
    engine.state.clocks.lastStartedAt = now - 1;
    const result = engine.checkTimeout(now);
    assert.ok(result);
    assert.equal(result?.ok, true);
    if (!result?.ok) return;
    assert.equal(result.state.endReason, "TIMEOUT_VS_INSUFFICIENT");
    assert.equal(result.state.winnerColor, null);
    assert.equal(result.state.status, "FINISHED");
  });

  it("flags timeout as a loss when the opponent can still mate", () => {
    const now = 5_000_000;
    const { engine, black } = startTwoPlayer({ now, initialTimeMs: 1000 });
    engine.chess.load("8/8/8/8/8/8/7q/K6k w - - 0 1");
    engine.state.clocks.whiteTimeMs = 0;
    engine.state.clocks.lastStartedAt = now - 1;
    const result = engine.checkTimeout(now);
    assert.ok(result);
    assert.equal(result?.ok, true);
    if (!result?.ok) return;
    assert.equal(result.state.endReason, "TIMEOUT");
    assert.equal(result.state.winnerColor, "BLACK");
    assert.equal(result.state.winnerId, black);
  });
});
