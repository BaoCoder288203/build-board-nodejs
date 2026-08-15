import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/uno.enums.js";
import { card, setHands, startTwoPlayer } from "./test-harness.js";

describe("engine WD4 challenge", () => {
  it("legal WD4 makes the challenger draw 6", () => {
    let now = 1_000_000;
    const { engine, state } = startTwoPlayer({ now });
    engine.nowFn = () => now;
    setHands(
      state,
      {
        p0: [card("wd4", "WILD", null, "WILD_DRAW_FOUR"), card("b1", "NUMBER", "BLUE", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
      "RED",
    );
    state.currentPlayerId = "p0";
    const play = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "wd4-legal",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "wd4", chosenColor: "GREEN" },
    });
    assert.equal(play.ok, true);
    if (!play.ok) return;
    assert.equal(play.state.status, "WAITING_FOR_CHALLENGE");
    assert.equal(play.state.challenge?.hadMatchingColor, false);

    const before = play.state.hands.p1?.length ?? 0;
    const challenge = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "chal-legal",
      type: ENGINE_ACTION.CHALLENGE_WD4,
    });
    assert.equal(challenge.ok, true);
    if (!challenge.ok) return;
    assert.equal((challenge.state.hands.p1?.length ?? 0) - before, 6);
    assert.equal(challenge.state.pendingDraw, 0);
    assert.equal(challenge.state.currentPlayerId, "p0");
  });

  it("illegal WD4 makes the accused draw 4", () => {
    let now = 1_000_000;
    const { engine, state } = startTwoPlayer({ now });
    engine.nowFn = () => now;
    setHands(
      state,
      {
        p0: [
          card("wd4", "WILD", null, "WILD_DRAW_FOUR"),
          card("r9", "NUMBER", "RED", 9),
        ],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
      "RED",
    );
    state.currentPlayerId = "p0";
    engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "wd4-illegal",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "wd4", chosenColor: "BLUE" },
    });
    const before = engine.state?.hands.p0?.length ?? 0;
    const challenge = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "chal-illegal",
      type: ENGINE_ACTION.CHALLENGE_WD4,
    });
    assert.equal(challenge.ok, true);
    if (!challenge.ok) return;
    assert.equal((challenge.state.hands.p0?.length ?? 0) - before, 4);
    assert.equal(challenge.state.currentPlayerId, "p1");
    assert.equal(challenge.state.pendingDraw, 0);
  });
});
