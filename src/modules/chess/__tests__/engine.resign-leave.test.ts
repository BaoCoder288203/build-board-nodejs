import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/chess.enums.js";
import { startTwoPlayer } from "./test-harness.js";

describe("chess resign and leave", () => {
  it("resigns and awards the opponent RESIGN", () => {
    const { engine, white, black } = startTwoPlayer();
    const result = engine.apply({
      requestId: "resign-1",
      playerId: white,
      type: ENGINE_ACTION.RESIGN,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.status, "FINISHED");
    assert.equal(result.state.endReason, "RESIGN");
    assert.equal(result.state.winnerColor, "BLACK");
    assert.equal(result.state.winnerId, black);
    assert.equal(result.state.clocks.runningColor, null);
  });

  it("leave mid-game finishes the room winner OPPONENT_LEFT (not lobby)", () => {
    const { engine, white, black } = startTwoPlayer();
    engine.apply({
      requestId: "e4",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "e4" },
    });
    const result = engine.apply({
      requestId: "leave-black",
      playerId: black,
      type: ENGINE_ACTION.PLAYER_LEFT,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.status, "FINISHED");
    assert.notEqual(result.state.status, "INITIALIZING");
    assert.equal(result.state.endReason, "OPPONENT_LEFT");
    assert.equal(result.state.winnerColor, "WHITE");
    assert.equal(result.state.winnerId, white);
    assert.equal(result.events.some((e) => e.type === "GAME_ENDED"), true);
  });

  it("publicGame snapshot uses client field names", () => {
    const { engine, white } = startTwoPlayer();
    engine.apply({
      requestId: "e4",
      playerId: white,
      type: ENGINE_ACTION.MOVE,
      payload: { from: "e2", to: "e4" },
    });
    const game = engine.publicGame();
    assert.equal(game.drawOffer, null);
    assert.equal(game.moves[0]?.ply, 1);
    assert.equal(game.moves[0]?.from, "e2");
    assert.equal(game.moves[0]?.fenAfter, game.fen);
    assert.equal(typeof game.clocks.whiteTimeMs, "number");
    assert.equal(game.clocks.runningColor, "BLACK");

    const offer = engine.apply({
      requestId: "offer",
      playerId: white,
      type: ENGINE_ACTION.OFFER_DRAW,
    });
    assert.equal(offer.ok, true);
    const snapshot = engine.publicGame();
    assert.equal(snapshot.drawOffer?.byPlayerId, white);
    assert.equal(snapshot.drawOffer?.byColor, "WHITE");
    const clocks = engine.syncClocks();
    assert.equal(clocks.turn, "BLACK");
    assert.equal(typeof clocks.serverTime, "string");
  });
});
