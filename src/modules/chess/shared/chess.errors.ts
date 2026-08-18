import { AppError } from "../../../common/app-error.js";

export const CHESS_ERROR = {
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_ROOM_MEMBER: "NOT_ROOM_MEMBER",
  SPECTATOR_ACTION_DENIED: "SPECTATOR_ACTION_DENIED",
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_FULL: "ROOM_FULL",
  ROOM_CLOSED: "ROOM_CLOSED",
  ROOM_ALREADY_PLAYING: "ROOM_ALREADY_PLAYING",
  ALREADY_IN_ROOM: "ALREADY_IN_ROOM",
  NOT_HOST: "NOT_HOST",
  NOT_READY: "NOT_READY",
  NOT_ENOUGH_PLAYERS: "NOT_ENOUGH_PLAYERS",
  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  GAME_NOT_STARTED: "GAME_NOT_STARTED",
  GAME_NOT_PLAYING: "GAME_NOT_PLAYING",
  GAME_ALREADY_FINISHED: "GAME_ALREADY_FINISHED",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  ILLEGAL_MOVE: "ILLEGAL_MOVE",
  PROMOTION_REQUIRED: "PROMOTION_REQUIRED",
  INVALID_PROMOTION: "INVALID_PROMOTION",
  DRAW_NOT_PENDING: "DRAW_NOT_PENDING",
  DRAW_ALREADY_OFFERED: "DRAW_ALREADY_OFFERED",
  RESIGN_NOT_ALLOWED: "RESIGN_NOT_ALLOWED",
  ACTION_ALREADY_PROCESSED: "ACTION_ALREADY_PROCESSED",
  SEQUENCE_GAP: "SEQUENCE_GAP",
  RATE_LIMITED: "RATE_LIMITED",
  MEETING_REQUIRED: "MEETING_REQUIRED",
  MEETING_ACCESS_DENIED: "MEETING_ACCESS_DENIED",
} as const;

export type ChessErrorCode = (typeof CHESS_ERROR)[keyof typeof CHESS_ERROR];

export type ChessErrorBody = {
  ok: false;
  code: ChessErrorCode;
  message: string;
  requestId?: string;
  sequence?: number;
};

const STATUS_BY_CODE: Record<ChessErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_ROOM_MEMBER: 403,
  SPECTATOR_ACTION_DENIED: 403,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  ROOM_CLOSED: 409,
  ROOM_ALREADY_PLAYING: 409,
  ALREADY_IN_ROOM: 409,
  NOT_HOST: 403,
  NOT_READY: 409,
  NOT_ENOUGH_PLAYERS: 409,
  GAME_NOT_FOUND: 404,
  GAME_NOT_STARTED: 409,
  GAME_NOT_PLAYING: 409,
  GAME_ALREADY_FINISHED: 409,
  NOT_YOUR_TURN: 409,
  ILLEGAL_MOVE: 409,
  PROMOTION_REQUIRED: 409,
  INVALID_PROMOTION: 400,
  DRAW_NOT_PENDING: 409,
  DRAW_ALREADY_OFFERED: 409,
  RESIGN_NOT_ALLOWED: 409,
  ACTION_ALREADY_PROCESSED: 409,
  SEQUENCE_GAP: 409,
  RATE_LIMITED: 429,
  MEETING_REQUIRED: 403,
  MEETING_ACCESS_DENIED: 403,
};

const MESSAGE_BY_CODE: Record<ChessErrorCode, string> = {
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Forbidden",
  NOT_ROOM_MEMBER: "You are not a member of this room",
  SPECTATOR_ACTION_DENIED: "Spectators cannot perform this action",
  ROOM_NOT_FOUND: "Room not found",
  ROOM_FULL: "Room is full",
  ROOM_CLOSED: "Room is closed",
  ROOM_ALREADY_PLAYING: "Game already in progress",
  ALREADY_IN_ROOM: "Already in this room",
  NOT_HOST: "Only the Chess host can do this",
  NOT_READY: "Not all players are ready",
  NOT_ENOUGH_PLAYERS: "Chess requires exactly 2 players",
  GAME_NOT_FOUND: "Game not found",
  GAME_NOT_STARTED: "Game has not started",
  GAME_NOT_PLAYING: "Game is not in a playable state",
  GAME_ALREADY_FINISHED: "Game already finished",
  NOT_YOUR_TURN: "Not your turn",
  ILLEGAL_MOVE: "Illegal move",
  PROMOTION_REQUIRED: "Pawn promotion piece is required",
  INVALID_PROMOTION: "Promotion must be q, r, b, or n",
  DRAW_NOT_PENDING: "No draw offer is pending",
  DRAW_ALREADY_OFFERED: "A draw offer is already pending",
  RESIGN_NOT_ALLOWED: "You cannot resign now",
  ACTION_ALREADY_PROCESSED: "Action already processed",
  SEQUENCE_GAP: "Sequence gap — request a snapshot",
  RATE_LIMITED: "Too many actions",
  MEETING_REQUIRED: "You must be in the meeting or invited",
  MEETING_ACCESS_DENIED: "Not a meeting participant",
};

export function chessError(
  code: ChessErrorCode,
  message?: string,
  requestId?: string,
): AppError {
  return new AppError(
    message ?? MESSAGE_BY_CODE[code],
    STATUS_BY_CODE[code],
    code,
    requestId ? { requestId } : undefined,
  );
}

export function chessErrorBody(
  code: ChessErrorCode,
  requestId?: string,
  sequence?: number,
): ChessErrorBody {
  return {
    ok: false,
    code,
    message: MESSAGE_BY_CODE[code],
    requestId,
    sequence,
  };
}
