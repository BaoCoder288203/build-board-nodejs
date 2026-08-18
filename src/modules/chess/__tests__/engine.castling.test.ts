import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess castling via chess.js", () => {
  it("blocks kingside castling when a piece sits on f1", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("r3k2r/8/8/8/8/8/8/R3KB1R w KQkq - 0 1");
    const result = engine.apply({
      requestId: "castle-blocked",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e1", to: "g1" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ILLEGAL_MOVE");
    assert.equal(engine.chess.get("e1")?.type, "k");
  });

  it("allows kingside castling on a clear back rank", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const result = engine.apply({
      requestId: "castle-ok",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e1", to: "g1" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(engine.chess.get("g1")?.type, "k");
    assert.equal(engine.chess.get("f1")?.type, "r");
    assert.equal(result.state.lastMove?.san, "O-O");
  });
});
