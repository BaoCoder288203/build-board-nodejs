import {
  UNO_ACTION_VALUE,
  UNO_CARD_TYPE,
  UNO_COLORS,
  UNO_WILD_VALUE,
  type UnoColor,
} from "../shared/uno.enums.js";
import type { GameRules, UnoCard } from "./game.state.js";

export type PlayContext = {
  topDiscard: UnoCard | null;
  currentColor: UnoColor | null;
  pendingDraw: number;
  rules: GameRules;
};

export function isUnoColor(value: unknown): value is UnoColor {
  return typeof value === "string" && (UNO_COLORS as string[]).includes(value);
}

export function hasMatchingColor(hand: UnoCard[], color: UnoColor | null) {
  if (!color) return false;
  return hand.some((card) => card.color === color);
}

export function isPlayable(card: UnoCard, ctx: PlayContext): boolean {
  if (ctx.pendingDraw > 0) {
    if (ctx.rules.stacking && card.value === UNO_ACTION_VALUE.DRAW_TWO) {
      return true;
    }
    return false;
  }

  if (card.type === UNO_CARD_TYPE.WILD) {
    return true;
  }

  if (ctx.currentColor && card.color === ctx.currentColor) {
    return true;
  }

  const top = ctx.topDiscard;
  if (top && card.type !== UNO_CARD_TYPE.WILD && card.value === top.value) {
    return true;
  }

  return false;
}

export function isWildDrawFour(card: UnoCard) {
  return (
    card.type === UNO_CARD_TYPE.WILD && card.value === UNO_WILD_VALUE.WILD_DRAW_FOUR
  );
}

export function isWild(card: UnoCard) {
  return card.type === UNO_CARD_TYPE.WILD;
}
