export const UNO_MVP = {
  minPlayers: 2,
  maxPlayers: 6,
  initialHandSize: 7,
  targetScore: 500,
  unoWindowMs: 2_000,
  wd4ChallengeWindowMs: 5_000,
  unoPenaltyDraw: 2,
  disconnectGraceMs: 60_000,
  stacking: false,
  jumpIn: false,
  sevenZero: false,
  drawUntilPlayable: false,
  forcePlay: false,
  allowChallenge: true,
  turnTimerDefaultOn: false,
} as const;

export const ROOM_STATUS = {
  WAITING: "WAITING",
  READY: "READY",
  PLAYING: "PLAYING",
  FINISHED: "FINISHED",
  CLOSED: "CLOSED",
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export const UNO_GAME_STATUS = {
  INITIALIZING: "INITIALIZING",
  DEALING: "DEALING",
  PLAYING: "PLAYING",
  WAITING_FOR_COLOR: "WAITING_FOR_COLOR",
  WAITING_FOR_CHALLENGE: "WAITING_FOR_CHALLENGE",
  PAUSED: "PAUSED",
  ROUND_FINISHED: "ROUND_FINISHED",
  FINISHED: "FINISHED",
  ABORTED: "ABORTED",
} as const;

export type UnoGameStatus = (typeof UNO_GAME_STATUS)[keyof typeof UNO_GAME_STATUS];

export const PLAYER_STATUS = {
  WAITING: "WAITING",
  READY: "READY",
  PLAYING: "PLAYING",
  FINISHED: "FINISHED",
  SPECTATING: "SPECTATING",
} as const;

export type PlayerStatus = (typeof PLAYER_STATUS)[keyof typeof PLAYER_STATUS];

export const CONNECTION_STATUS = {
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
  RECONNECTING: "RECONNECTING",
  LEFT: "LEFT",
  REMOVED: "REMOVED",
} as const;

export type ConnectionStatus =
  (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS];

export const UNO_DIRECTION = {
  CLOCKWISE: "CLOCKWISE",
  COUNTER_CLOCKWISE: "COUNTER_CLOCKWISE",
} as const;

export type UnoDirection = (typeof UNO_DIRECTION)[keyof typeof UNO_DIRECTION];

export const UNO_COLOR = {
  RED: "RED",
  YELLOW: "YELLOW",
  GREEN: "GREEN",
  BLUE: "BLUE",
} as const;

export type UnoColor = (typeof UNO_COLOR)[keyof typeof UNO_COLOR];

export const UNO_COLORS: UnoColor[] = ["RED", "YELLOW", "GREEN", "BLUE"];

export const UNO_CARD_TYPE = {
  NUMBER: "NUMBER",
  ACTION: "ACTION",
  WILD: "WILD",
} as const;

export type UnoCardType = (typeof UNO_CARD_TYPE)[keyof typeof UNO_CARD_TYPE];

export const UNO_ACTION_VALUE = {
  SKIP: "SKIP",
  REVERSE: "REVERSE",
  DRAW_TWO: "DRAW_TWO",
} as const;

export type UnoActionValue =
  (typeof UNO_ACTION_VALUE)[keyof typeof UNO_ACTION_VALUE];

export const UNO_WILD_VALUE = {
  WILD: "WILD",
  WILD_DRAW_FOUR: "WILD_DRAW_FOUR",
} as const;

export type UnoWildValue = (typeof UNO_WILD_VALUE)[keyof typeof UNO_WILD_VALUE];

export type UnoNumberValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export const ENGINE_ACTION = {
  START_GAME: "START_GAME",
  PLAY_CARD: "PLAY_CARD",
  DRAW_CARD: "DRAW_CARD",
  PASS: "PASS",
  CALL_UNO: "CALL_UNO",
  CHOOSE_COLOR: "CHOOSE_COLOR",
  CHALLENGE_WD4: "CHALLENGE_WD4",
  TURN_TIMEOUT: "TURN_TIMEOUT",
  CALL_OUT_UNO: "CALL_OUT_UNO",
  EXPIRE_CHALLENGE: "EXPIRE_CHALLENGE",
} as const;

export type UnoEngineActionType =
  | (typeof ENGINE_ACTION)[keyof typeof ENGINE_ACTION];

export const ROOM_CONTEXT = {
  MEETING: "MEETING",
  BOARD: "BOARD",
  WORKSPACE: "WORKSPACE",
} as const;

export type UnoRoomContextType =
  (typeof ROOM_CONTEXT)[keyof typeof ROOM_CONTEXT];

export const END_REASON = {
  PLAYER_WON_ROUND: "PLAYER_WON_ROUND",
  PLAYER_REACHED_TARGET: "PLAYER_REACHED_TARGET",
  LAST_PLAYER_REMAINING: "LAST_PLAYER_REMAINING",
  HOST_CLOSED: "HOST_CLOSED",
  ABANDONED: "ABANDONED",
  ERROR: "ERROR",
} as const;

export type UnoEndReason = (typeof END_REASON)[keyof typeof END_REASON];

export const CHALLENGE_KIND = {
  WD4: "WD4",
  UNO_PENALTY: "UNO_PENALTY",
} as const;

export type UnoChallengeKind =
  (typeof CHALLENGE_KIND)[keyof typeof CHALLENGE_KIND];

export const UNSUPPORTED_HOUSE_RULES = ["stacking", "jumpIn", "sevenZero"] as const;
