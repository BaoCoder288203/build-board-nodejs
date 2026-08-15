import {
  CONNECTION_STATUS,
  PLAYER_STATUS,
  UNO_DIRECTION,
  type UnoDirection,
} from "../shared/uno.enums.js";
import type { UnoEnginePlayer, UnoGameState } from "./game.state.js";

export function flipDirection(direction: UnoDirection): UnoDirection {
  return direction === UNO_DIRECTION.CLOCKWISE
    ? UNO_DIRECTION.COUNTER_CLOCKWISE
    : UNO_DIRECTION.CLOCKWISE;
}

export function seatedPlayers(state: UnoGameState): UnoEnginePlayer[] {
  return [...state.players]
    .filter((p) => !isSkippedSeat(p))
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

export function isSkippedSeat(player: UnoEnginePlayer) {
  return (
    player.status === PLAYER_STATUS.SPECTATING ||
    player.status === PLAYER_STATUS.FINISHED ||
    player.connectionStatus === CONNECTION_STATUS.LEFT ||
    player.connectionStatus === CONNECTION_STATUS.REMOVED
  );
}

export function nextPlayerId(
  state: UnoGameState,
  fromPlayerId: string,
  skipCount = 0,
  direction = state.direction,
): string {
  const seats = seatedPlayers(state).filter((p) => !isSkippedSeat(p));
  if (seats.length === 0) return fromPlayerId;
  const fromIndex = seats.findIndex((p) => p.playerId === fromPlayerId);
  const start = fromIndex >= 0 ? fromIndex : 0;
  const step = direction === UNO_DIRECTION.CLOCKWISE ? 1 : -1;
  const steps = 1 + skipCount;
  const nextIndex = (start + step * steps + seats.length * 10) % seats.length;
  return seats[nextIndex]?.playerId ?? fromPlayerId;
}

export type ConnectionLookup = Record<string, string | undefined>;

export function shouldAutoAct(
  playerId: string,
  connections: ConnectionLookup | undefined,
) {
  if (!connections) return false;
  const status = connections[playerId];
  return status === CONNECTION_STATUS.DISCONNECTED;
}
