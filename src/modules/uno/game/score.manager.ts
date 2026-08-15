import {
  END_REASON,
  PLAYER_STATUS,
  UNO_ACTION_VALUE,
  UNO_CARD_TYPE,
  UNO_GAME_STATUS,
  UNO_WILD_VALUE,
} from "../shared/uno.enums.js";
import type { UnoCard, UnoGameState } from "./game.state.js";

export function cardPoints(card: UnoCard): number {
  if (card.type === UNO_CARD_TYPE.NUMBER && typeof card.value === "number") {
    return card.value;
  }
  if (
    card.value === UNO_ACTION_VALUE.SKIP ||
    card.value === UNO_ACTION_VALUE.REVERSE ||
    card.value === UNO_ACTION_VALUE.DRAW_TWO
  ) {
    return 20;
  }
  if (
    card.value === UNO_WILD_VALUE.WILD ||
    card.value === UNO_WILD_VALUE.WILD_DRAW_FOUR
  ) {
    return 50;
  }
  return 0;
}

export function remainingCardPoints(
  state: UnoGameState,
  winnerId: string,
): Record<string, number> {
  const points: Record<string, number> = {};
  for (const player of state.players) {
    const hand = state.hands[player.playerId] ?? [];
    points[player.playerId] = hand.reduce((sum, card) => sum + cardPoints(card), 0);
  }
  points[winnerId] = 0;
  return points;
}

export function applyRoundWin(state: UnoGameState, winnerId: string): UnoGameState {
  const remaining = remainingCardPoints(state, winnerId);
  const gained = Object.entries(remaining)
    .filter(([id]) => id !== winnerId)
    .reduce((sum, [, pts]) => sum + pts, 0);

  const scores = { ...state.scores };
  scores[winnerId] = (scores[winnerId] ?? 0) + gained;

  const reachedTarget = (scores[winnerId] ?? 0) >= state.targetScore;
  const players = state.players.map((p) =>
    p.playerId === winnerId ? { ...p, status: PLAYER_STATUS.FINISHED } : p,
  );

  return {
    ...state,
    scores,
    players,
    winnerId,
    status: reachedTarget ? UNO_GAME_STATUS.FINISHED : UNO_GAME_STATUS.ROUND_FINISHED,
    endReason: reachedTarget
      ? END_REASON.PLAYER_REACHED_TARGET
      : END_REASON.PLAYER_WON_ROUND,
    pendingDraw: 0,
    lastDrawnCardId: null,
    unoWindow: null,
    colorChooserPlayerId: null,
    pendingWild: null,
    challenge: null,
    wd4HadMatchingColor: null,
  };
}
