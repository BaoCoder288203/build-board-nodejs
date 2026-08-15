import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ENGINE_ACTION } from "../shared/uno.enums.js";
import { card, setHands, startTwoPlayer } from "./test-harness.js";

describe("engine play card", () => {
  it("plays a matching color", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5), card("b1", "NUMBER", "BLUE", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "play-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.currentColor, "RED");
    assert.equal(result.state.currentPlayerId, "p1");
    assert.equal(result.state.hands.p0?.some((c) => c.cardId === "r5"), false);
    assert.equal(result.state.discardPile.at(-1)?.cardId, "r5");
  });

  it("rejects not your turn", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5)],
        p1: [card("r3", "NUMBER", "RED", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "play-2",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r3" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "NOT_YOUR_TURN");
  });

  it("rejects card not owned", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5)],
        p1: [card("r3", "NUMBER", "RED", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "play-3",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r3" },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "CARD_NOT_OWNED");
  });

  it("skips the next player", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("skip", "ACTION", "RED", "SKIP"), card("r1", "NUMBER", "RED", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "skip-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "skip" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.currentPlayerId, "p0");
  });

  it("treats reverse as skip with 2 players", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("rev", "ACTION", "RED", "REVERSE"), card("r1", "NUMBER", "RED", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "rev-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "rev" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.direction, "COUNTER_CLOCKWISE");
    assert.equal(result.state.currentPlayerId, "p0");
  });

  it("adds pendingDraw for +2", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("d2", "ACTION", "RED", "DRAW_TWO"), card("r1", "NUMBER", "RED", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "d2-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "d2" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.pendingDraw, 2);
    assert.equal(result.state.currentPlayerId, "p1");
    const blocked = engine.apply({
      gameId: state.gameId,
      playerId: "p1",
      requestId: "play-blocked",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "y3" },
    });
    assert.equal(blocked.ok, false);
  });

  it("changes color on wild", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("wild", "WILD", null, "WILD"), card("r1", "NUMBER", "RED", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const play = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "wild-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "wild", chosenColor: "BLUE" },
    });
    assert.equal(play.ok, true);
    if (!play.ok) return;
    assert.equal(play.state.currentColor, "BLUE");
    assert.equal(play.state.currentPlayerId, "p1");
  });

  it("ends the round at 0 cards", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5)],
        p1: [card("y9", "NUMBER", "YELLOW", 9), card("skip", "ACTION", "BLUE", "SKIP")],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const result = engine.apply({
      gameId: state.gameId,
      playerId: "p0",
      requestId: "win-1",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.state.winnerId, "p0");
    assert.equal(result.state.hands.p0?.length, 0);
    assert.ok(
      result.state.status === "ROUND_FINISHED" || result.state.status === "FINISHED",
    );
    assert.ok((result.state.scores.p0 ?? 0) > 0);
  });

  it("is idempotent on requestId", () => {
    const { engine, state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("r5", "NUMBER", "RED", 5), card("b1", "NUMBER", "BLUE", 1)],
        p1: [card("y3", "NUMBER", "YELLOW", 3)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    state.currentPlayerId = "p0";
    const cmd = {
      gameId: state.gameId,
      playerId: "p0" as const,
      requestId: "same-id",
      type: ENGINE_ACTION.PLAY_CARD,
      payload: { cardId: "r5" },
    };
    const first = engine.apply(cmd);
    const seq = first.ok ? first.sequence : -1;
    const second = engine.apply(cmd);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.sequence, seq);
    assert.equal(second.state.hands.p0?.filter((c) => c.cardId === "r5").length, 0);
  });
});
