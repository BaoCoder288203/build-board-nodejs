import { randomInt } from "node:crypto";
import {
  UNO_ACTION_VALUE,
  UNO_CARD_TYPE,
  UNO_COLORS,
  UNO_WILD_VALUE,
  type UnoColor,
  type UnoNumberValue,
} from "../shared/uno.enums.js";
import type { UnoCard } from "./game.state.js";

export function createStandardDeck(): UnoCard[] {
  const cards: UnoCard[] = [];
  let n = 0;

  for (const color of UNO_COLORS) {
    cards.push(numberCard(`${color}-0-a`, color, 0));
    n += 1;
    for (let value = 1; value <= 9; value += 1) {
      const v = value as UnoNumberValue;
      cards.push(numberCard(`${color}-${v}-a`, color, v));
      cards.push(numberCard(`${color}-${v}-b`, color, v));
      n += 2;
    }
    for (const action of [
      UNO_ACTION_VALUE.SKIP,
      UNO_ACTION_VALUE.REVERSE,
      UNO_ACTION_VALUE.DRAW_TWO,
    ] as const) {
      cards.push(actionCard(`${color}-${action}-a`, color, action));
      cards.push(actionCard(`${color}-${action}-b`, color, action));
      n += 2;
    }
  }

  for (let i = 0; i < 4; i += 1) {
    cards.push({
      cardId: `WILD-${i}`,
      type: UNO_CARD_TYPE.WILD,
      color: null,
      value: UNO_WILD_VALUE.WILD,
    });
    cards.push({
      cardId: `WD4-${i}`,
      type: UNO_CARD_TYPE.WILD,
      color: null,
      value: UNO_WILD_VALUE.WILD_DRAW_FOUR,
    });
    n += 2;
  }

  if (n !== 108 || cards.length !== 108) {
    throw new Error("UNO deck must contain 108 cards");
  }
  return cards;
}

function numberCard(cardId: string, color: UnoColor, value: UnoNumberValue): UnoCard {
  return { cardId, type: UNO_CARD_TYPE.NUMBER, color, value };
}

function actionCard(
  cardId: string,
  color: UnoColor,
  value: (typeof UNO_ACTION_VALUE)[keyof typeof UNO_ACTION_VALUE],
): UnoCard {
  return { cardId, type: UNO_CARD_TYPE.ACTION, color, value };
}

export function shuffleDeck(cards: UnoCard[]): UnoCard[] {
  const next = [...cards];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const a = next[i];
    const b = next[j];
    if (a === undefined || b === undefined) continue;
    next[i] = b;
    next[j] = a;
  }
  return next;
}

export function drawFromPile(
  drawPile: UnoCard[],
  discardPile: UnoCard[],
  count: number,
): { cards: UnoCard[]; drawPile: UnoCard[]; discardPile: UnoCard[] } {
  let pile = [...drawPile];
  let discard = [...discardPile];
  const cards: UnoCard[] = [];

  for (let i = 0; i < count; i += 1) {
    if (pile.length === 0) {
      const recycled = recycleDiscard(discard);
      pile = recycled.drawPile;
      discard = recycled.discardPile;
    }
    const card = pile.shift();
    if (!card) break;
    cards.push(card);
  }

  return { cards, drawPile: pile, discardPile: discard };
}

export function recycleDiscard(discardPile: UnoCard[]): {
  drawPile: UnoCard[];
  discardPile: UnoCard[];
} {
  if (discardPile.length <= 1) {
    return { drawPile: [], discardPile: [...discardPile] };
  }
  const top = discardPile[discardPile.length - 1];
  if (!top) {
    return { drawPile: [], discardPile: [] };
  }
  const rest = discardPile.slice(0, -1);
  return { drawPile: shuffleDeck(rest), discardPile: [top] };
}

export function publicCard(card: UnoCard | undefined | null) {
  if (!card) return null;
  return {
    cardId: card.cardId,
    type: card.type,
    color: card.color,
    value: card.value,
  };
}
