import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess promotion", () => {
  it("requires promotion when a pawn reaches the last rank", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    const result = engine.apply({
      requestId: "promo-missing",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "a7", to: "a8" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "PROMOTION_REQUIRED");
    assert.equal(engine.state.status, "WAITING_FOR_PROMOTION");
    assert.equal(engine.chess.get("a7")?.type, "p");
  });

  it("promotes to queen when specified", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    const result = engine.apply({
      requestId: "promo-q",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "a7", to: "a8", promotion: "q" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(engine.chess.get("a8")?.type, "q");
    assert.equal(result.state.lastMove?.promotion, "q");
  });

  it("rejects an invalid promotion piece", () => {
    const { engine, white } = startTwoPlayer();
    engine.chess.load("4k3/P7/8/8/8/8/8/4K3 w - - 0 1");
    const result = engine.apply({
      requestId: "promo-k",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "a7", to: "a8", promotion: "k" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "INVALID_PROMOTION");
  });
});
