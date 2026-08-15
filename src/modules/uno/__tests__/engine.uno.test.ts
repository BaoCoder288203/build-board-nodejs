import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/uno.enums.js";
import { card, setHands, startTwoPlayer } from "./test-harness.js";

describe("engine UNO window", () => {
  it("opens a window at 1 card and accepts declare", () => {
    let now = 1_000_000;
    const { engine, state } = startTwoPlayer({ now });
    engine.nowFn = () => now;
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5), card("r7", "NUMBER", "RED", 7)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const play = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "to-one",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    });
    assert.equal(play.ok, true);
    if (!play.ok) return;
    assert.equal(play.state.hands.p0?.length, 1);
    assert.ok(play.state.unoWindow);

    const declared = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "uno-1",
      type: ENGINE_ACTION.CALL_UNO,
    });
    assert.equal(declared.ok, true);
    if (!declared.ok) return;
    assert.equal(declared.state.players.find((p) => p.playerId === "p0")?.calledUno, true);
  });

  it("applies UNO penalty after the window", () => {
    let now = 1_000_000;
    const engineNow = () => now;
    const { engine, state } = startTwoPlayer({ now });
    engine.nowFn = engineNow;
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5), card("r7", "NUMBER", "RED", 7)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "to-one-2",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    });
    now += 2_001;
    const before = engine.state?.hands.p0?.length ?? 0;
    const callout = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "penalty-1",
      type: ENGINE_ACTION.CALL_OUT_UNO,
    });
    assert.equal(callout.ok, true);
    if (!callout.ok) return;
    assert.equal((callout.state.hands.p0?.length ?? 0) - before, 2);
  });

  it("does not penalize a player who already has 0 cards", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const win = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "win-no-uno",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    });
    assert.equal(win.ok, true);
    if (!win.ok) return;
    assert.equal(win.state.hands.p0?.length, 0);
    const callout = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "late-callout",
      type: ENGINE_ACTION.CALL_OUT_UNO,
    });
    assert.equal(callout.ok, false);
    if (callout.ok) return;
    assert.equal(callout.code, "CHALLENGE_NOT_ALLOWED");
  });
});
