import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess legal / illegal moves", () => {
  it("plays a legal pawn move", () => {
    const { engine, white } = startTwoPlayer();
    const result = engine.apply({
      requestId: "e4",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "e4" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.match(result.state.fen, /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b /);
    assert.equal(result.state.turn, "BLACK");
    assert.equal(result.state.sequence, 2);
    assert.equal(result.state.lastMove?.san, "e4");
  });

  it("rejects an illegal pawn leap", () => {
    const { engine, white } = startTwoPlayer();
    const result = engine.apply({
      requestId: "e5",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "e5" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ILLEGAL_MOVE");
    assert.equal(engine.chess.fen().startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w"), true);
  });

  it("rejects moving on the opponent turn", () => {
    const { engine, black } = startTwoPlayer();
    const result = engine.apply({
      requestId: "not-turn",
      playerId: black,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e7", to: "e5" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_YOUR_TURN");
  });

  it("rejects a pinned knight leaving the pin line", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("4r3/3k4/8/8/8/8/4N3/4K3 w - - 0 1");
    const result = engine.apply({
      requestId: "pinned",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "c3" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "ILLEGAL_MOVE");
  });
});
