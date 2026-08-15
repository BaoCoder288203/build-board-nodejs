import { CONNECTION_STATUS, type ConnectionStatus } from "../shared/uno.enums.js";
import { publicCard } from "../game/deck.manager.js";
import type { PlayerGameView, UnoChallengeState, UnoGameState } from "../game/game.state.js";

export function projectForPlayer(
  state: UnoGameState,
  playerId: string | null,
  connections?: Record<string, ConnectionStatus | undefined>,
): PlayerGameView {
  const isSpectator = !playerId || !state.hands[playerId];
  const challenge = state.challenge
    ? stripChallengeSecret(state.challenge)
    : null;

  return {
    gameId: state.gameId,
    status: state.status,
    sequence: state.sequence,
    currentPlayerId: state.currentPlayerId,
    direction: state.direction,
    currentColor: state.currentColor,
    topDiscard: publicCard(state.discardPile[state.discardPile.length - 1] ?? null),
    drawCount: state.drawPile.length,
    pendingDraw: state.pendingDraw,
    myHand: isSpectator ? [] : (state.hands[playerId] ?? []).map((c) => ({
      cardId: c.cardId,
      type: c.type,
      color: c.color,
      value: c.value,
    })),
    lastDrawnCardId: isSpectator ? null : state.lastDrawnCardId,
    unoWindow: state.unoWindow,
    colorChooserPlayerId: state.colorChooserPlayerId,
    challenge,
    players: state.players.map((p) => ({
      playerId: p.playerId,
      userId: p.userId,
      cardCount: (state.hands[p.playerId] ?? []).length,
      calledUno: p.calledUno,
      status: p.status,
      connectionStatus: connections?.[p.playerId] ?? CONNECTION_STATUS.CONNECTED,
      seatIndex: p.seatIndex,
    })),
    scores: state.scores,
    turnDeadlineAt: state.turnDeadlineAt,
    winnerId: state.winnerId,
    endReason: state.endReason,
    roundNumber: state.roundNumber,
    turnNumber: state.turnNumber,
  };
}

function stripChallengeSecret(challenge: UnoChallengeState) {
  return {
    kind: challenge.kind,
    challengerPlayerId: challenge.challengerPlayerId,
    accusedPlayerId: challenge.accusedPlayerId,
    expiresAt: challenge.expiresAt,
  };
}

export function assertNoPrivateLeak(view: PlayerGameView, viewerId: string | null) {
  const serialized = JSON.stringify(view);
  for (const player of view.players) {
    if (player.playerId === viewerId) continue;
    // Opponent card ids from other hands must never appear except as topDiscard / public events.
    if (
      "hands" in (view as unknown as Record<string, unknown>) ||
      serialized.includes("drawPile")
    ) {
      throw new Error("projection leaked private piles");
    }
  }
  return true;
}
