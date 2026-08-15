import assert from "node:assert/strict";
import { ENGINE_ACTION } from "../shared/uno.enums.js";
import { GameEngine } from "../game/game.engine.js";
import { createStandardDeck } from "../game/deck.manager.js";
import { DEFAULT_GAME_RULES, type UnoCard, type UnoGameState } from "../game/game.state.js";

export function startTwoPlayer(options?: {
  now?: number;
  rules?: Partial<typeof DEFAULT_GAME_RULES>;
  deck?: UnoCard[];
}) {
  const engine = new GameEngine(() => options?.now ?? 1_000_000);
  const result = engine.apply({
    gameId: "game-1",
    requestId: "start-1",
    type: ENGINE_ACTION.START_GAME,
    payload: {
      roomId: "room-1",
      shuffle: false,
      deck: options?.deck ?? createStandardDeck(),
      rules: { ...DEFAULT_GAME_RULES, ...options?.rules },
      players: [
        { playerId: "p0", userId: "u0", seatIndex: 0 },
        { playerId: "p1", userId: "u1", seatIndex: 1 },
      ],
    },
  });
  assert.equal(result.ok, true);
  if (!result.ok || !engine.state) throw new Error("failed to start");
  return { engine, state: engine.state, p0: "p0", p1: "p1" };
}

export function card(
  cardId: string,
  type: UnoCard["type"],
  color: UnoCard["color"],
  value: UnoCard["value"],
): UnoCard {
  return { cardId, type, color, value };
}

export function setHands(
  state: UnoGameState,
  hands: Record<string, UnoCard[]>,
  top: UnoCard,
  color = top.color,
) {
  state.hands = hands;
  state.discardPile = [top];
  state.currentColor = color;
  state.status = "PLAYING";
  state.pendingDraw = 0;
  state.lastDrawnCardId = null;
  state.unoWindow = null;
  state.challenge = null;
  state.pendingWild = null;
}
