import {
  ENGINE_ACTION,
  PLAYER_STATUS,
  UNO_ACTION_VALUE,
  UNO_CARD_TYPE,
  UNO_COLOR,
  UNO_DIRECTION,
  UNO_GAME_STATUS,
  UNO_MVP,
  UNO_WILD_VALUE,
  type UnoColor,
  type UnoWildValue,
} from "../shared/uno.enums.js";
import { UNO_ERROR, type UnoErrorCode } from "../shared/uno.errors.js";
import {
  createStandardDeck,
  drawFromPile,
  shuffleDeck,
} from "./deck.manager.js";
import { applyRoundWin, remainingCardPoints } from "./score.manager.js";
import {
  hasMatchingColor,
  isPlayable,
  isUnoColor,
  isWild,
  isWildDrawFour,
  type PlayContext,
} from "./rule.engine.js";
import { flipDirection, nextPlayerId } from "./turn.manager.js";
import type {
  ChooseColorPayload,
  EngineCommand,
  EngineReject,
  EngineResult,
  PlayCardPayload,
  StartGamePayload,
  UnoCard,
  UnoDomainEvent,
  UnoEnginePlayer,
  UnoGameState,
} from "./game.state.js";
import { DEFAULT_GAME_RULES } from "./game.state.js";

function reject(requestId: string, code: UnoErrorCode): EngineReject {
  return { ok: false, code, requestId };
}

function playCtx(state: UnoGameState): PlayContext {
  return {
    topDiscard: state.discardPile[state.discardPile.length - 1] ?? null,
    currentColor: state.currentColor,
    pendingDraw: state.pendingDraw,
    rules: state.rules,
  };
}

function handOf(state: UnoGameState, playerId: string): UnoCard[] {
  return state.hands[playerId] ?? [];
}

function setHand(state: UnoGameState, playerId: string, hand: UnoCard[]) {
  state.hands = { ...state.hands, [playerId]: hand };
}

function findPlayer(state: UnoGameState, playerId: string) {
  return state.players.find((p) => p.playerId === playerId);
}

function ok(
  state: UnoGameState,
  events: UnoDomainEvent[],
  privateHandsChanged: string[],
): EngineResult {
  return {
    ok: true,
    sequence: state.sequence,
    state,
    events,
    privateHandsChanged,
  };
}

function emitTurn(state: UnoGameState, events: UnoDomainEvent[]) {
  events.push({
    type: "TURN_CHANGED",
    payload: {
      currentPlayerId: state.currentPlayerId,
      direction: state.direction,
      turnNumber: state.turnNumber,
      deadlineAt: state.turnDeadlineAt,
      sequence: state.sequence,
    },
  });
}

function advanceTurn(state: UnoGameState, fromPlayerId: string, skipCount = 0) {
  state.lastDrawnCardId = null;
  state.currentPlayerId = nextPlayerId(state, fromPlayerId, skipCount);
  state.turnNumber += 1;
  state.turnDeadlineAt = state.rules.turnTimerEnabled
    ? new Date(Date.now() + 30_000).toISOString()
    : null;
  if (state.status === UNO_GAME_STATUS.PLAYING) {
    // keep PLAYING
  } else if (
    state.status !== UNO_GAME_STATUS.WAITING_FOR_COLOR &&
    state.status !== UNO_GAME_STATUS.WAITING_FOR_CHALLENGE &&
    state.status !== UNO_GAME_STATUS.ROUND_FINISHED &&
    state.status !== UNO_GAME_STATUS.FINISHED
  ) {
    state.status = UNO_GAME_STATUS.PLAYING;
  }
}

function maybeOpenUnoWindow(
  state: UnoGameState,
  playerId: string,
  now: number,
) {
  const hand = handOf(state, playerId);
  const player = findPlayer(state, playerId);
  if (!player) return;
  if (hand.length === 1) {
    player.calledUno = false;
    state.unoWindow = {
      targetPlayerId: playerId,
      expiresAt: now + UNO_MVP.unoWindowMs,
      called: false,
    };
    return;
  }
  if (hand.length !== 1) {
    player.calledUno = false;
    if (state.unoWindow?.targetPlayerId === playerId) {
      state.unoWindow = null;
    }
  }
}

function finishIfEmpty(
  state: UnoGameState,
  playerId: string,
  events: UnoDomainEvent[],
): boolean {
  if (handOf(state, playerId).length !== 0) return false;
  const ended = applyRoundWin(state, playerId);
  Object.assign(state, ended);
  events.push({
    type: "ROUND_ENDED",
    payload: {
      winnerId: playerId,
      roundNumber: state.roundNumber,
      scores: state.scores,
      remainingCardPoints: remainingCardPoints(state, playerId),
      sequence: state.sequence,
    },
  });
  if (state.status === UNO_GAME_STATUS.FINISHED) {
    events.push({
      type: "GAME_ENDED",
      payload: {
        winnerId: state.winnerId,
        reason: state.endReason,
        scores: state.scores,
        sequence: state.sequence,
      },
    });
  }
  return true;
}

function drawCards(
  state: UnoGameState,
  playerId: string,
  count: number,
): UnoCard[] {
  const drawn = drawFromPile(state.drawPile, state.discardPile, count);
  state.drawPile = drawn.drawPile;
  state.discardPile = drawn.discardPile;
  setHand(state, playerId, [...handOf(state, playerId), ...drawn.cards]);
  return drawn.cards;
}

function applyFirstCard(state: UnoGameState, now: number, events: UnoDomainEvent[]) {
  const firstPlayer = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex)[0];
  if (!firstPlayer) return;
  state.currentPlayerId = firstPlayer.playerId;

  let top = state.drawPile.shift();
  while (top && isWildDrawFour(top)) {
    state.drawPile.push(top);
    state.drawPile = shuffleDeck(state.drawPile);
    top = state.drawPile.shift();
  }
  if (!top) return;
  state.discardPile.push(top);

  if (top.type === UNO_CARD_TYPE.NUMBER && top.color) {
    state.currentColor = top.color;
    return;
  }
  if (top.type === UNO_CARD_TYPE.ACTION && top.color) {
    state.currentColor = top.color;
    if (top.value === UNO_ACTION_VALUE.SKIP) {
      advanceTurn(state, firstPlayer.playerId, 0);
      return;
    }
    if (top.value === UNO_ACTION_VALUE.REVERSE) {
      state.direction = flipDirection(state.direction);
      if (state.players.length === 2) {
        advanceTurn(state, firstPlayer.playerId, 0);
      }
      return;
    }
    if (top.value === UNO_ACTION_VALUE.DRAW_TWO) {
      state.pendingDraw += 2;
      return;
    }
  }
  if (top.type === UNO_CARD_TYPE.WILD && top.value === UNO_WILD_VALUE.WILD) {
    state.status = UNO_GAME_STATUS.WAITING_FOR_COLOR;
    state.colorChooserPlayerId = firstPlayer.playerId;
    state.pendingWild = UNO_WILD_VALUE.WILD;
    events.push({
      type: "STATE_PATCH",
      payload: { status: state.status, colorChooserPlayerId: firstPlayer.playerId },
    });
    return;
  }
  void now;
}

function dealHands(state: UnoGameState) {
  const size = state.rules.initialHandSize;
  const ordered = [...state.players].sort((a, b) => a.seatIndex - b.seatIndex);
  for (let i = 0; i < size; i += 1) {
    for (const player of ordered) {
      const card = state.drawPile.shift();
      if (!card) break;
      setHand(state, player.playerId, [...handOf(state, player.playerId), card]);
    }
  }
}

export function startGame(
  payload: StartGamePayload,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  if (payload.players.length < UNO_MVP.minPlayers) {
    return reject(command.requestId, UNO_ERROR.NOT_ENOUGH_PLAYERS);
  }
  if (payload.rules.stacking || payload.rules.jumpIn || payload.rules.sevenZero) {
    return reject(command.requestId, UNO_ERROR.UNSUPPORTED_RULE);
  }

  const deck =
    payload.shuffle === false && payload.deck
      ? [...payload.deck]
      : shuffleDeck(payload.deck ?? createStandardDeck());

  const players: UnoEnginePlayer[] = payload.players.map((p) => ({
    playerId: p.playerId,
    userId: p.userId,
    seatIndex: p.seatIndex,
    status: PLAYER_STATUS.PLAYING,
    calledUno: false,
    connectionStatus: "CONNECTED",
  }));

  const scores: Record<string, number> = {};
  const hands: Record<string, UnoCard[]> = {};
  for (const p of players) {
    scores[p.playerId] = 0;
    hands[p.playerId] = [];
  }

  const state: UnoGameState = {
    gameId: command.gameId,
    roomId: payload.roomId,
    status: UNO_GAME_STATUS.DEALING,
    sequence: 0,
    rules: payload.rules,
    players,
    currentPlayerId: null,
    direction: UNO_DIRECTION.CLOCKWISE,
    currentColor: null,
    drawPile: deck,
    discardPile: [],
    hands,
    turnNumber: 1,
    roundNumber: 1,
    scores,
    targetScore: payload.rules.targetScore,
    pendingDraw: 0,
    lastDrawnCardId: null,
    unoWindow: null,
    colorChooserPlayerId: null,
    pendingWild: null,
    wd4HadMatchingColor: null,
    challenge: null,
    turnDeadlineAt: null,
  };

  dealHands(state);
  const events: UnoDomainEvent[] = [];
  applyFirstCard(state, now, events);
  if (state.status !== UNO_GAME_STATUS.WAITING_FOR_COLOR) {
    state.status = UNO_GAME_STATUS.PLAYING;
  }
  state.sequence = 1;
  events.unshift({
    type: "GAME_STARTED",
    payload: {
      gameId: state.gameId,
      currentPlayerId: state.currentPlayerId,
      direction: state.direction,
      currentColor: state.currentColor,
      sequence: state.sequence,
    },
  });
  emitTurn(state, events);
  return ok(state, events, players.map((p) => p.playerId));
}

export function dealNextRound(state: UnoGameState, now: number): EngineResult {
  const events: UnoDomainEvent[] = [];
  state.roundNumber += 1;
  state.status = UNO_GAME_STATUS.DEALING;
  state.drawPile = shuffleDeck(createStandardDeck());
  state.discardPile = [];
  state.pendingDraw = 0;
  state.lastDrawnCardId = null;
  state.unoWindow = null;
  state.colorChooserPlayerId = null;
  state.pendingWild = null;
  state.wd4HadMatchingColor = null;
  state.challenge = null;
  state.winnerId = undefined;
  state.endReason = undefined;
  state.direction = UNO_DIRECTION.CLOCKWISE;
  state.currentColor = null;
  for (const player of state.players) {
    if (player.status !== PLAYER_STATUS.SPECTATING) {
      player.status = PLAYER_STATUS.PLAYING;
      player.calledUno = false;
    }
    state.hands[player.playerId] = [];
  }
  dealHands(state);
  applyFirstCard(state, now, events);
  if (!state.colorChooserPlayerId) {
    state.status = UNO_GAME_STATUS.PLAYING;
  }
  state.sequence += 1;
  events.unshift({
    type: "GAME_STARTED",
    payload: {
      gameId: state.gameId,
      roundNumber: state.roundNumber,
      currentPlayerId: state.currentPlayerId,
      sequence: state.sequence,
    },
  });
  emitTurn(state, events);
  return ok(state, events, state.players.map((p) => p.playerId));
}

function parsePlayPayload(payload: unknown): PlayCardPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const cardId = (payload as PlayCardPayload).cardId;
  if (typeof cardId !== "string" || cardId.length === 0) return null;
  const chosenColor = (payload as PlayCardPayload).chosenColor;
  return { cardId, chosenColor };
}

function playCard(
  state: UnoGameState,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  const playerId = command.playerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  if (state.status === UNO_GAME_STATUS.FINISHED) {
    return reject(command.requestId, UNO_ERROR.GAME_ALREADY_FINISHED);
  }
  if (state.status !== UNO_GAME_STATUS.PLAYING) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
  if (state.currentPlayerId !== playerId) {
    return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  }
  const parsed = parsePlayPayload(command.payload);
  if (!parsed) return reject(command.requestId, UNO_ERROR.INVALID_CARD);

  const hand = handOf(state, playerId);
  const cardIndex = hand.findIndex((c) => c.cardId === parsed.cardId);
  const card = cardIndex >= 0 ? hand[cardIndex] : undefined;
  if (!card) return reject(command.requestId, UNO_ERROR.CARD_NOT_OWNED);

  if (state.lastDrawnCardId && parsed.cardId !== state.lastDrawnCardId) {
    return reject(command.requestId, UNO_ERROR.INVALID_CARD);
  }
  if (!isPlayable(card, playCtx(state))) {
    return reject(command.requestId, UNO_ERROR.INVALID_CARD);
  }

  const remaining = [...hand.slice(0, cardIndex), ...hand.slice(cardIndex + 1)];
  const wd4Illegal = isWildDrawFour(card)
    ? hasMatchingColor(remaining, state.currentColor)
    : false;

  setHand(state, playerId, remaining);
  state.discardPile = [...state.discardPile, card];
  state.lastDrawnCardId = null;
  const player = findPlayer(state, playerId);
  if (player) player.calledUno = false;

  const events: UnoDomainEvent[] = [];
  state.sequence += 1;

  events.push({
    type: "CARD_PLAYED",
    payload: {
      playerId,
      card: {
        cardId: card.cardId,
        type: card.type,
        color: card.color,
        value: card.value,
      },
      currentColor: card.color ?? state.currentColor,
      pendingDraw: state.pendingDraw,
      sequence: state.sequence,
    },
  });

  if (finishIfEmpty(state, playerId, events)) {
    return ok(state, events, [playerId]);
  }
  maybeOpenUnoWindow(state, playerId, now);

  if (card.type === UNO_CARD_TYPE.NUMBER && card.color) {
    state.currentColor = card.color;
    state.status = UNO_GAME_STATUS.PLAYING;
    advanceTurn(state, playerId, 0);
    emitTurn(state, events);
    return ok(state, events, [playerId]);
  }

  if (card.type === UNO_CARD_TYPE.ACTION && card.color) {
    state.currentColor = card.color;
    state.status = UNO_GAME_STATUS.PLAYING;
    if (card.value === UNO_ACTION_VALUE.SKIP) {
      advanceTurn(state, playerId, 1);
      emitTurn(state, events);
      return ok(state, events, [playerId]);
    }
    if (card.value === UNO_ACTION_VALUE.REVERSE) {
      state.direction = flipDirection(state.direction);
      const skip = state.players.filter((p) => p.status === PLAYER_STATUS.PLAYING)
        .length === 2
        ? 1
        : 0;
      advanceTurn(state, playerId, skip);
      emitTurn(state, events);
      return ok(state, events, [playerId]);
    }
    if (card.value === UNO_ACTION_VALUE.DRAW_TWO) {
      state.pendingDraw += 2;
      advanceTurn(state, playerId, 0);
      emitTurn(state, events);
      return ok(state, events, [playerId]);
    }
  }

  if (isWild(card)) {
    const wildValue = card.value as UnoWildValue;
    state.pendingWild = wildValue;
    state.wd4HadMatchingColor = isWildDrawFour(card) ? wd4Illegal : null;
    if (parsed.chosenColor) {
      if (!isUnoColor(parsed.chosenColor)) {
        return reject(command.requestId, UNO_ERROR.INVALID_COLOR);
      }
      return applyChosenColor(state, playerId, parsed.chosenColor, now, events);
    }
    state.status = UNO_GAME_STATUS.WAITING_FOR_COLOR;
    state.colorChooserPlayerId = playerId;
    return ok(state, events, [playerId]);
  }

  advanceTurn(state, playerId, 0);
  emitTurn(state, events);
  return ok(state, events, [playerId]);
}

function applyChosenColor(
  state: UnoGameState,
  playerId: string,
  color: UnoColor,
  now: number,
  events: UnoDomainEvent[],
): EngineResult {
  state.currentColor = color;
  state.colorChooserPlayerId = null;
  events.push({
    type: "COLOR_SELECTED",
    payload: { playerId, color, sequence: state.sequence },
  });

  if (state.pendingWild === UNO_WILD_VALUE.WILD_DRAW_FOUR && state.rules.allowChallenge) {
    const challengerId = nextPlayerId(state, playerId, 0);
    state.status = UNO_GAME_STATUS.WAITING_FOR_CHALLENGE;
    state.challenge = {
      kind: "WD4",
      challengerPlayerId: challengerId,
      accusedPlayerId: playerId,
      hadMatchingColor: Boolean(state.wd4HadMatchingColor),
      expiresAt: now + UNO_MVP.wd4ChallengeWindowMs,
    };
    state.currentPlayerId = challengerId;
    emitTurn(state, events);
    return ok(state, events, [playerId]);
  }

  if (state.pendingWild === UNO_WILD_VALUE.WILD_DRAW_FOUR) {
    state.pendingDraw += 4;
  }
  state.pendingWild = null;
  state.wd4HadMatchingColor = null;
  state.status = UNO_GAME_STATUS.PLAYING;
  advanceTurn(state, playerId, 0);
  emitTurn(state, events);
  return ok(state, events, [playerId]);
}

function chooseColor(
  state: UnoGameState,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  const playerId = command.playerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  if (state.status !== UNO_GAME_STATUS.WAITING_FOR_COLOR) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
  if (state.colorChooserPlayerId !== playerId) {
    return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  }
  const color = (command.payload as ChooseColorPayload | undefined)?.color;
  if (!isUnoColor(color)) return reject(command.requestId, UNO_ERROR.INVALID_COLOR);
  state.sequence += 1;
  return applyChosenColor(state, playerId, color, now, []);
}

function drawCard(
  state: UnoGameState,
  command: EngineCommand,
): EngineResult | EngineReject {
  const playerId = command.playerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  if (state.status !== UNO_GAME_STATUS.PLAYING) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
  if (state.currentPlayerId !== playerId) {
    return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  }
  if (state.lastDrawnCardId) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }

  const events: UnoDomainEvent[] = [];
  state.sequence += 1;
  const count = state.pendingDraw > 0 ? state.pendingDraw : 1;
  const penalty = state.pendingDraw > 0;
  const cards = drawCards(state, playerId, count);

  events.push({
    type: "CARD_DRAWN",
    payload: {
      playerId,
      drawnCount: cards.length,
      cards,
      sequence: state.sequence,
    },
  });

  if (penalty) {
    state.pendingDraw = 0;
    state.lastDrawnCardId = null;
    state.status = UNO_GAME_STATUS.PLAYING;
    advanceTurn(state, playerId, 0);
    emitTurn(state, events);
    return ok(state, events, [playerId]);
  }

  const drawn = cards[0];
  if (!drawn || !isPlayable(drawn, playCtx(state))) {
    state.lastDrawnCardId = null;
    advanceTurn(state, playerId, 0);
    emitTurn(state, events);
    return ok(state, events, [playerId]);
  }

  state.lastDrawnCardId = drawn.cardId;
  return ok(state, events, [playerId]);
}

function passTurn(
  state: UnoGameState,
  command: EngineCommand,
): EngineResult | EngineReject {
  const playerId = command.playerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  if (state.status !== UNO_GAME_STATUS.PLAYING) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
  if (state.currentPlayerId !== playerId) {
    return reject(command.requestId, UNO_ERROR.NOT_YOUR_TURN);
  }
  if (!state.lastDrawnCardId) {
    return reject(command.requestId, UNO_ERROR.PASS_NOT_ALLOWED);
  }
  state.sequence += 1;
  const events: UnoDomainEvent[] = [];
  advanceTurn(state, playerId, 0);
  emitTurn(state, events);
  return ok(state, events, []);
}

function callUno(
  state: UnoGameState,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  const playerId = command.playerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.UNO_NOT_ALLOWED);
  const window = state.unoWindow;
  if (!window || window.targetPlayerId !== playerId) {
    return reject(command.requestId, UNO_ERROR.UNO_NOT_ALLOWED);
  }
  if (now > window.expiresAt) {
    return reject(command.requestId, UNO_ERROR.UNO_NOT_ALLOWED);
  }
  const player = findPlayer(state, playerId);
  if (player) player.calledUno = true;
  state.unoWindow = null;
  state.sequence += 1;
  return ok(
    state,
    [{ type: "UNO_DECLARED", payload: { playerId, sequence: state.sequence } }],
    [],
  );
}

function callOutUno(
  state: UnoGameState,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  const actorId = command.playerId;
  if (!actorId) return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  const window = state.unoWindow;
  if (!window) return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  if (window.targetPlayerId === actorId) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  if (now <= window.expiresAt) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  const targetId = window.targetPlayerId;
  if (handOf(state, targetId).length === 0) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  if (handOf(state, targetId).length !== 1) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  const target = findPlayer(state, targetId);
  if (target?.calledUno) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }

  const cards = drawCards(state, targetId, state.rules.unoPenaltyDraw);
  state.unoWindow = null;
  if (target) target.calledUno = false;
  state.sequence += 1;
  return ok(
    state,
    [
      {
        type: "CHALLENGE_RESOLVED",
        payload: {
          kind: "UNO_PENALTY",
          actorId,
          targetId,
          legal: true,
          drawnCount: cards.length,
          sequence: state.sequence,
        },
      },
      {
        type: "CARD_DRAWN",
        payload: {
          playerId: targetId,
          drawnCount: cards.length,
          cards,
          sequence: state.sequence,
        },
      },
    ],
    [targetId],
  );
}

function challengeWd4(
  state: UnoGameState,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  const actorId = command.playerId;
  if (!actorId) return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  if (state.status !== UNO_GAME_STATUS.WAITING_FOR_CHALLENGE || !state.challenge) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  if (now > state.challenge.expiresAt) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  if (actorId !== state.challenge.challengerPlayerId) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }

  const legal = !state.challenge.hadMatchingColor;
  const accusedId = state.challenge.accusedPlayerId;
  const challengerId = state.challenge.challengerPlayerId;
  const events: UnoDomainEvent[] = [];
  state.sequence += 1;
  state.challenge = null;
  state.pendingWild = null;
  state.wd4HadMatchingColor = null;
  state.pendingDraw = 0;
  state.status = UNO_GAME_STATUS.PLAYING;

  if (legal) {
    const cards = drawCards(state, challengerId, 6);
    events.push({
      type: "CHALLENGE_RESOLVED",
      payload: {
        kind: "WD4",
        legal: true,
        challengerId,
        accusedId,
        drawnPlayerId: challengerId,
        drawnCount: 6,
        sequence: state.sequence,
      },
    });
    events.push({
      type: "CARD_DRAWN",
      payload: {
        playerId: challengerId,
        drawnCount: cards.length,
        cards,
        sequence: state.sequence,
      },
    });
    advanceTurn(state, challengerId, 0);
    emitTurn(state, events);
    return ok(state, events, [challengerId]);
  }

  const cards = drawCards(state, accusedId, 4);
  events.push({
    type: "CHALLENGE_RESOLVED",
    payload: {
      kind: "WD4",
      legal: false,
      challengerId,
      accusedId,
      drawnPlayerId: accusedId,
      drawnCount: 4,
      sequence: state.sequence,
    },
  });
  events.push({
    type: "CARD_DRAWN",
    payload: {
      playerId: accusedId,
      drawnCount: cards.length,
      cards,
      sequence: state.sequence,
    },
  });
  state.currentPlayerId = challengerId;
  state.turnNumber += 1;
  emitTurn(state, events);
  return ok(state, events, [accusedId]);
}

function expireChallenge(
  state: UnoGameState,
  command: EngineCommand,
): EngineResult | EngineReject {
  if (state.status !== UNO_GAME_STATUS.WAITING_FOR_CHALLENGE || !state.challenge) {
    return reject(command.requestId, UNO_ERROR.CHALLENGE_NOT_ALLOWED);
  }
  const challengerId = state.challenge.challengerPlayerId;
  state.sequence += 1;
  state.pendingDraw = 4;
  state.currentPlayerId = challengerId;
  state.status = UNO_GAME_STATUS.PLAYING;
  state.challenge = null;
  state.pendingWild = null;
  state.wd4HadMatchingColor = null;
  const events: UnoDomainEvent[] = [];
  emitTurn(state, events);
  return ok(state, events, []);
}

function turnTimeout(
  state: UnoGameState,
  command: EngineCommand,
): EngineResult | EngineReject {
  if (state.status === UNO_GAME_STATUS.WAITING_FOR_CHALLENGE) {
    return expireChallenge(state, command);
  }
  if (state.status !== UNO_GAME_STATUS.PLAYING) {
    return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
  const playerId = state.currentPlayerId;
  if (!playerId) return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);

  const events: UnoDomainEvent[] = [];
  state.sequence += 1;
  const count = state.pendingDraw > 0 ? state.pendingDraw : 1;
  const cards = drawCards(state, playerId, count);
  state.pendingDraw = 0;
  state.lastDrawnCardId = null;
  events.push({
    type: "TURN_TIMEOUT",
    payload: { playerId, drawnCount: cards.length, sequence: state.sequence },
  });
  events.push({
    type: "CARD_DRAWN",
    payload: {
      playerId,
      drawnCount: cards.length,
      cards,
      sequence: state.sequence,
    },
  });
  advanceTurn(state, playerId, 0);
  emitTurn(state, events);
  return ok(state, events, [playerId]);
}

export function applyCommand(
  input: UnoGameState | null,
  command: EngineCommand,
  now: number,
): EngineResult | EngineReject {
  if (command.type === ENGINE_ACTION.START_GAME) {
    const payload = command.payload as StartGamePayload | undefined;
    if (!payload) return reject(command.requestId, UNO_ERROR.GAME_NOT_STARTED);
    return startGame(
      {
        ...payload,
        rules: { ...DEFAULT_GAME_RULES, ...payload.rules },
      },
      command,
      now,
    );
  }

  if (!input) return reject(command.requestId, UNO_ERROR.GAME_NOT_FOUND);
  if (
    input.status === UNO_GAME_STATUS.FINISHED ||
    input.status === UNO_GAME_STATUS.ABORTED
  ) {
    return reject(command.requestId, UNO_ERROR.GAME_ALREADY_FINISHED);
  }

  const state = JSON.parse(JSON.stringify(input)) as UnoGameState;

  switch (command.type) {
    case ENGINE_ACTION.PLAY_CARD:
      return playCard(state, command, now);
    case ENGINE_ACTION.DRAW_CARD:
      return drawCard(state, command);
    case ENGINE_ACTION.PASS:
      return passTurn(state, command);
    case ENGINE_ACTION.CHOOSE_COLOR:
      return chooseColor(state, command, now);
    case ENGINE_ACTION.CALL_UNO:
      return callUno(state, command, now);
    case ENGINE_ACTION.CHALLENGE_WD4:
      return challengeWd4(state, command, now);
    case ENGINE_ACTION.CALL_OUT_UNO:
      return callOutUno(state, command, now);
    case ENGINE_ACTION.TURN_TIMEOUT:
      return turnTimeout(state, command);
    case ENGINE_ACTION.EXPIRE_CHALLENGE:
      return expireChallenge(state, command);
    default:
      return reject(command.requestId, UNO_ERROR.GAME_NOT_PLAYING);
  }
}

export class GameEngine {
  state: UnoGameState | null = null;
  private readonly cache = new Map<string, EngineResult | EngineReject>();

  constructor(public nowFn: () => number = () => Date.now()) {}

  apply(command: EngineCommand): EngineResult | EngineReject {
    const cached = this.cache.get(command.requestId);
    if (cached) return cached;
    const result = applyCommand(this.state, command, this.nowFn());
    this.cache.set(command.requestId, result);
    if (result.ok) this.state = result.state;
    return result;
  }
}

export { DEFAULT_GAME_RULES, UNO_COLOR };
