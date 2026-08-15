import type {
  ConnectionStatus,
  PlayerStatus,
  UnoColor,
  UnoDirection,
  UnoEndReason,
  UnoEngineActionType,
  UnoGameStatus,
  UnoNumberValue,
  UnoActionValue,
  UnoWildValue,
  UnoCardType,
} from "../shared/uno.enums.js";
import type { UnoErrorCode } from "../shared/uno.errors.js";
import { UNO_MVP } from "../shared/uno.enums.js";

export type UnoCard = {
  cardId: string;
  type: UnoCardType;
  color: UnoColor | null;
  value: UnoNumberValue | UnoActionValue | UnoWildValue;
};

export type GameRules = {
  targetScore: number;
  stacking: boolean;
  jumpIn: boolean;
  sevenZero: boolean;
  drawUntilPlayable: boolean;
  forcePlay: boolean;
  allowChallenge: boolean;
  challengePenalty: number;
  initialHandSize: number;
  autoStartNextRound: boolean;
  unoPenaltyDraw: number;
  turnTimerEnabled: boolean;
};

export const DEFAULT_GAME_RULES: GameRules = {
  targetScore: UNO_MVP.targetScore,
  stacking: false,
  jumpIn: false,
  sevenZero: false,
  drawUntilPlayable: false,
  forcePlay: false,
  allowChallenge: true,
  challengePenalty: 4,
  initialHandSize: UNO_MVP.initialHandSize,
  autoStartNextRound: true,
  unoPenaltyDraw: UNO_MVP.unoPenaltyDraw,
  turnTimerEnabled: UNO_MVP.turnTimerDefaultOn,
};

export type UnoEnginePlayer = {
  playerId: string;
  userId: string;
  seatIndex: number;
  status: PlayerStatus;
  calledUno: boolean;
  connectionStatus: ConnectionStatus;
};

export type UnoWindow = {
  targetPlayerId: string;
  expiresAt: number;
  called: boolean;
};

export type UnoChallengeState = {
  kind: "WD4";
  challengerPlayerId: string;
  accusedPlayerId: string;
  hadMatchingColor: boolean;
  expiresAt: number;
};

export type UnoGameState = {
  gameId: string;
  roomId: string;
  status: UnoGameStatus;
  sequence: number;
  rules: GameRules;
  players: UnoEnginePlayer[];
  currentPlayerId: string | null;
  direction: UnoDirection;
  currentColor: UnoColor | null;
  drawPile: UnoCard[];
  discardPile: UnoCard[];
  hands: Record<string, UnoCard[]>;
  turnNumber: number;
  roundNumber: number;
  scores: Record<string, number>;
  targetScore: number;
  pendingDraw: number;
  lastDrawnCardId: string | null;
  unoWindow: UnoWindow | null;
  colorChooserPlayerId: string | null;
  pendingWild: UnoWildValue | null;
  wd4HadMatchingColor: boolean | null;
  challenge: UnoChallengeState | null;
  turnDeadlineAt: string | null;
  winnerId?: string;
  endReason?: UnoEndReason;
};

export type EngineCommand = {
  gameId: string;
  playerId?: string;
  requestId: string;
  type: UnoEngineActionType;
  payload?: unknown;
};

export type UnoDomainEventType =
  | "GAME_STARTED"
  | "CARD_PLAYED"
  | "CARD_DRAWN"
  | "COLOR_SELECTED"
  | "UNO_DECLARED"
  | "CHALLENGE_RESOLVED"
  | "TURN_CHANGED"
  | "TURN_TIMEOUT"
  | "ROUND_ENDED"
  | "GAME_ENDED"
  | "STATE_PATCH";

export type UnoDomainEvent = {
  type: UnoDomainEventType;
  payload: unknown;
};

export type EngineResult = {
  ok: true;
  sequence: number;
  state: UnoGameState;
  events: UnoDomainEvent[];
  privateHandsChanged: string[];
};

export type EngineReject = {
  ok: false;
  code: UnoErrorCode;
  requestId: string;
};

export type PublicCard = {
  cardId: string;
  type: UnoCardType;
  color: UnoColor | null;
  value: string | number;
};

export type PlayerGameView = {
  gameId: string;
  status: UnoGameStatus;
  sequence: number;
  currentPlayerId: string | null;
  direction: UnoDirection;
  currentColor: UnoColor | null;
  topDiscard: PublicCard | null;
  drawCount: number;
  pendingDraw: number;
  myHand: PublicCard[];
  lastDrawnCardId: string | null;
  unoWindow: UnoWindow | null;
  colorChooserPlayerId: string | null;
  challenge: Omit<UnoChallengeState, "hadMatchingColor"> | null;
  players: Array<{
    playerId: string;
    userId: string;
    cardCount: number;
    calledUno: boolean;
    status: PlayerStatus;
    connectionStatus?: ConnectionStatus;
    seatIndex: number;
  }>;
  scores: Record<string, number>;
  turnDeadlineAt: string | null;
  winnerId?: string;
  endReason?: UnoEndReason;
  roundNumber: number;
  turnNumber: number;
};

export type PlayCardPayload = {
  cardId: string;
  chosenColor?: UnoColor;
};

export type ChooseColorPayload = {
  color: UnoColor;
};

export type StartGamePayload = {
  roomId: string;
  players: Array<{ playerId: string; userId: string; seatIndex: number }>;
  rules: GameRules;
  deck?: UnoCard[];
  shuffle?: boolean;
};
