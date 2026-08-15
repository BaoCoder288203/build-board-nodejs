import { AppError } from "../../../common/app-error.js";

export const UNO_ERROR = {
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
  HOST_TRANSFER_REQUIRED: "HOST_TRANSFER_REQUIRED",
  NOT_READY: "NOT_READY",
  NOT_ENOUGH_PLAYERS: "NOT_ENOUGH_PLAYERS",
  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  GAME_NOT_STARTED: "GAME_NOT_STARTED",
  GAME_NOT_PLAYING: "GAME_NOT_PLAYING",
  GAME_ALREADY_FINISHED: "GAME_ALREADY_FINISHED",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  CARD_NOT_OWNED: "CARD_NOT_OWNED",
  INVALID_CARD: "INVALID_CARD",
  INVALID_COLOR: "INVALID_COLOR",
  UNO_NOT_ALLOWED: "UNO_NOT_ALLOWED",
  CHALLENGE_NOT_ALLOWED: "CHALLENGE_NOT_ALLOWED",
  ACTION_ALREADY_PROCESSED: "ACTION_ALREADY_PROCESSED",
  PASS_NOT_ALLOWED: "PASS_NOT_ALLOWED",
  SEQUENCE_GAP: "SEQUENCE_GAP",
  RATE_LIMITED: "RATE_LIMITED",
  MEETING_REQUIRED: "MEETING_REQUIRED",
  MEETING_ACCESS_DENIED: "MEETING_ACCESS_DENIED",
  UNSUPPORTED_RULE: "UNSUPPORTED_RULE",
} as const;

export type UnoErrorCode = (typeof UNO_ERROR)[keyof typeof UNO_ERROR];

export type UnoErrorBody = {
  ok: false;
  code: UnoErrorCode;
  message: string;
  requestId?: string;
  sequence?: number;
};

const STATUS_BY_CODE: Record<UnoErrorCode, number> = {
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
  HOST_TRANSFER_REQUIRED: 409,
  NOT_READY: 409,
  NOT_ENOUGH_PLAYERS: 409,
  GAME_NOT_FOUND: 404,
  GAME_NOT_STARTED: 409,
  GAME_NOT_PLAYING: 409,
  GAME_ALREADY_FINISHED: 409,
  NOT_YOUR_TURN: 409,
  CARD_NOT_OWNED: 409,
  INVALID_CARD: 409,
  INVALID_COLOR: 400,
  UNO_NOT_ALLOWED: 409,
  CHALLENGE_NOT_ALLOWED: 409,
  ACTION_ALREADY_PROCESSED: 409,
  PASS_NOT_ALLOWED: 409,
  SEQUENCE_GAP: 409,
  RATE_LIMITED: 429,
  MEETING_REQUIRED: 403,
  MEETING_ACCESS_DENIED: 403,
  UNSUPPORTED_RULE: 400,
};

const MESSAGE_BY_CODE: Record<UnoErrorCode, string> = {
  UNAUTHENTICATED: "Authentication required",
  FORBIDDEN: "Forbidden",
  NOT_ROOM_MEMBER: "You are not a member of this room",
  SPECTATOR_ACTION_DENIED: "Spectators cannot perform this action",
  ROOM_NOT_FOUND: "Room not found",
  ROOM_FULL: "Room is full",
  ROOM_CLOSED: "Room is closed",
  ROOM_ALREADY_PLAYING: "Game already in progress",
  ALREADY_IN_ROOM: "Already in this room",
  NOT_HOST: "Only the UNO host can do this",
  HOST_TRANSFER_REQUIRED: "Host transfer required",
  NOT_READY: "Not all players are ready",
  NOT_ENOUGH_PLAYERS: "Need at least 2 players",
  GAME_NOT_FOUND: "Game not found",
  GAME_NOT_STARTED: "Game has not started",
  GAME_NOT_PLAYING: "Game is not in a playable state",
  GAME_ALREADY_FINISHED: "Game already finished",
  NOT_YOUR_TURN: "Not your turn",
  CARD_NOT_OWNED: "Card is not in your hand",
  INVALID_CARD: "That card cannot be played",
  INVALID_COLOR: "Invalid color",
  UNO_NOT_ALLOWED: "UNO cannot be declared now",
  CHALLENGE_NOT_ALLOWED: "Challenge is not allowed",
  ACTION_ALREADY_PROCESSED: "Action already processed",
  PASS_NOT_ALLOWED: "You can only pass after drawing a playable card",
  SEQUENCE_GAP: "Sequence gap — request a snapshot",
  RATE_LIMITED: "Too many actions",
  MEETING_REQUIRED: "You must be in the meeting or invited",
  MEETING_ACCESS_DENIED: "Not a meeting participant",
  UNSUPPORTED_RULE: "Unsupported house rule for MVP",
};

export function unoError(
  code: UnoErrorCode,
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

export function unoErrorBody(
  code: UnoErrorCode,
  requestId?: string,
  sequence?: number,
): UnoErrorBody {
  return {
    ok: false,
    code,
    message: MESSAGE_BY_CODE[code],
    requestId,
    sequence,
  };
}
