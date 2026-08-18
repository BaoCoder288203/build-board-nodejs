import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess requestId idempotency", () => {
  it("returns the original result for a duplicate requestId", () => {
    const { engine, white } = startTwoPlayer();
    const cmd = {
      requestId: "same-move",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "e4" },
    } as const;
    const first = engine.apply(cmd);
    assert.equal(first.ok, true);
    const seq = first.ok ? first.sequence : -1;
    const fen = engine.chess.fen();
    const second = engine.apply(cmd);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.alreadyProcessed, true);
    assert.equal(second.sequence, seq);
    assert.equal(engine.chess.fen(), fen);
    assert.equal(engine.state.moves.length, 1);
  });
});
