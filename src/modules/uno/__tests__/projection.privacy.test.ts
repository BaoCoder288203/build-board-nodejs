import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectForPlayer } from "../socket/uno.projection.js";
import { card, setHands, startTwoPlayer } from "./test-harness.js";

describe("projection privacy", () => {
  it("hides opponent hands and the draw pile", () => {
    const { state } = startTwoPlayer();
    setHands(
      state,
      {
        p0: [card("secret-0", "NUMBER", "RED", 5)],
        p1: [card("secret-1", "NUMBER", "BLUE", 9)],
      },
      card("r2", "NUMBER", "RED", 2),
    );
    const view = projectForPlayer(state, "p0");
    const json = JSON.stringify(view);
    assert.equal(view.myHand.some((c) => c.cardId === "secret-0"), true);
    assert.equal(json.includes("secret-1"), false);
    assert.equal(json.includes("drawPile"), false);
    assert.equal(
      view.players.find((p) => p.playerId === "p1")?.cardCount,
      1,
    );
    const spectator = projectForPlayer(state, null);
    assert.equal(spectator.myHand.length, 0);
    assert.equal(JSON.stringify(spectator).includes("secret-0"), false);
  });
});
