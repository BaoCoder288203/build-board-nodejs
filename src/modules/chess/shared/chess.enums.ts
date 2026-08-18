export const CHESS_MVP = {
  minPlayers: 2,
  maxPlayers: 2,
  allowSpectator: true,
  initialTimeMs: 10 * 60 * 1000,
  incrementMs: 0,
  clockEnabled: true,
  lowTimeMs: 30_000,
  criticalTimeMs: 10_000,
  disconnectGraceMs: 8_000,
  hostColor: "WHITE",
} as const;

export const ROOM_STATUS = {
  WAITING: "WAITING",
  READY: "READY",
  PLAYING: "PLAYING",
  FINISHED: "FINISHED",
  CLOSED: "CLOSED",
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export const CHESS_GAME_STATUS = {
  INITIALIZING: "INITIALIZING",
  PLAYING: "PLAYING",
  WAITING_FOR_PROMOTION: "WAITING_FOR_PROMOTION",
  WAITING_FOR_DRAW: "WAITING_FOR_DRAW",
  PAUSED: "PAUSED",
  FINISHED: "FINISHED",
  ABORTED: "ABORTED",
} as const;

export type ChessGameStatus =
  (typeof CHESS_GAME_STATUS)[keyof typeof CHESS_GAME_STATUS];

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

export const CHESS_COLOR = {
  WHITE: "WHITE",
  BLACK: "BLACK",
} as const;

export type ChessColor = (typeof CHESS_COLOR)[keyof typeof CHESS_COLOR];

export const CHESS_PIECE_TYPE = {
  K: "K",
  Q: "Q",
  R: "R",
  B: "B",
  N: "N",
  P: "P",
} as const;

export type ChessPieceType =
  (typeof CHESS_PIECE_TYPE)[keyof typeof CHESS_PIECE_TYPE];

export const CHESS_PROMOTION = {
  q: "q",
  r: "r",
  b: "b",
  n: "n",
} as const;

export type ChessPromotion =
  (typeof CHESS_PROMOTION)[keyof typeof CHESS_PROMOTION];

export const ENGINE_ACTION = {
  START_GAME: "START_GAME",
  MOVE: "MOVE",
  RESIGN: "RESIGN",
  OFFER_DRAW: "OFFER_DRAW",
  RESPOND_DRAW: "RESPOND_DRAW",
  TIMEOUT: "TIMEOUT",
  PLAYER_LEFT: "PLAYER_LEFT",
  ABORT: "ABORT",
} as const;

export type ChessEngineActionType =
  (typeof ENGINE_ACTION)[keyof typeof ENGINE_ACTION];

export const ROOM_CONTEXT = {
  MEETING: "MEETING",
  BOARD: "BOARD",
  WORKSPACE: "WORKSPACE",
} as const;

export type ChessContextType =
  (typeof ROOM_CONTEXT)[keyof typeof ROOM_CONTEXT];

export const END_REASON = {
  CHECKMATE: "CHECKMATE",
  STALEMATE: "STALEMATE",
  INSUFFICIENT_MATERIAL: "INSUFFICIENT_MATERIAL",
  THREEFOLD: "THREEFOLD",
  FIFTY_MOVE: "FIFTY_MOVE",
  AGREED_DRAW: "AGREED_DRAW",
  RESIGN: "RESIGN",
  TIMEOUT: "TIMEOUT",
  TIMEOUT_VS_INSUFFICIENT: "TIMEOUT_VS_INSUFFICIENT",
  OPPONENT_LEFT: "OPPONENT_LEFT",
  HOST_CLOSED: "HOST_CLOSED",
  ABANDONED: "ABANDONED",
} as const;

export type ChessEndReason = (typeof END_REASON)[keyof typeof END_REASON];
