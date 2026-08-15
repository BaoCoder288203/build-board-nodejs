export const UNO_CLIENT_EVENT = {
  ROOM_JOIN: "uno:room:join",
  ROOM_LEAVE: "uno:room:leave",
  PLAYER_READY: "uno:player:ready",
  PLAYER_UNREADY: "uno:player:unready",
  GAME_START: "uno:game:start",
  CARD_PLAY: "uno:card:play",
  CARD_DRAW: "uno:card:draw",
  TURN_PASS: "uno:turn:pass",
  COLOR_SELECT: "uno:color:select",
  DECLARE: "uno:declare",
  CHALLENGE: "uno:challenge",
  SNAPSHOT_REQUEST: "uno:snapshot:request",
  REMATCH_REQUEST: "uno:rematch:request",
} as const;

export const UNO_SERVER_EVENT = {
  ROOM_UPDATED: "uno:room:updated",
  ROOM_INVITE: "uno:room:invite",
  PLAYER_JOINED: "uno:player:joined",
  PLAYER_LEFT: "uno:player:left",
  PLAYER_DISCONNECTED: "uno:player:disconnected",
  PLAYER_RECONNECTED: "uno:player:reconnected",
  GAME_STARTED: "uno:game:started",
  GAME_STATE: "uno:game:state",
  CARD_PLAYED: "uno:card:played",
  CARD_DRAWN: "uno:card:drawn",
  COLOR_SELECTED: "uno:color:selected",
  DECLARED: "uno:declared",
  CHALLENGED: "uno:challenged",
  TURN_CHANGED: "uno:turn:changed",
  TURN_TIMEOUT: "uno:turn:timeout",
  ROUND_ENDED: "uno:round:ended",
  GAME_ENDED: "uno:game:ended",
  SNAPSHOT: "uno:snapshot",
  ERROR: "uno:error",
} as const;

export type UnoClientRequest<T = unknown> = {
  requestId: string;
  roomId: string;
  gameId?: string;
  payload?: T;
};

export type UnoServerEvent<T = unknown> = {
  eventId: string;
  roomId: string;
  gameId?: string;
  sequence?: number;
  type: string;
  payload: T;
  occurredAt: string;
};

export type UnoAck =
  | { ok: true; sequence?: number }
  | { ok: false; code: string; message: string; requestId?: string };
