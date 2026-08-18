export const CHESS_CLIENT_EVENT = {
  ROOM_JOIN: "chess:room:join",
  ROOM_LEAVE: "chess:room:leave",
  PLAYER_READY: "chess:player:ready",
  PLAYER_UNREADY: "chess:player:unready",
  GAME_START: "chess:game:start",
  MOVE: "chess:move",
  RESIGN: "chess:resign",
  DRAW_OFFER: "chess:draw:offer",
  DRAW_RESPOND: "chess:draw:respond",
  SNAPSHOT_REQUEST: "chess:snapshot:request",
  REMATCH_REQUEST: "chess:rematch:request",
} as const;

export const CHESS_SERVER_EVENT = {
  ROOM_UPDATED: "chess:room:updated",
  ROOM_INVITE: "chess:room:invite",
  PLAYER_JOINED: "chess:player:joined",
  PLAYER_LEFT: "chess:player:left",
  PLAYER_DISCONNECTED: "chess:player:disconnected",
  PLAYER_RECONNECTED: "chess:player:reconnected",
  GAME_STARTED: "chess:game:started",
  GAME_STATE: "chess:game:state",
  MOVED: "chess:moved",
  DRAW_OFFERED: "chess:draw:offered",
  DRAW_RESOLVED: "chess:draw:resolved",
  CLOCK_SYNC: "chess:clock:sync",
  GAME_ENDED: "chess:game:ended",
  SNAPSHOT: "chess:snapshot",
  ERROR: "chess:error",
} as const;

export type ChessClientRequest<T = unknown> = {
  requestId: string;
  roomId: string;
  gameId?: string;
  payload?: T;
};

export type ChessServerEvent<T = unknown> = {
  eventId: string;
  roomId: string;
  gameId?: string;
  sequence?: number;
  type: string;
  payload: T;
  occurredAt: string;
};

export type ChessAck =
  | { ok: true; sequence?: number }
  | { ok: false; code: string; message: string; requestId?: string };
