export type RealtimeMetricsSnapshot = {
  connections: number;
  peakConnections: number;
  roomJoins: number;
  roomLeaves: number;
  typingEvents: number;
  rateLimited: number;
  authFailures: number;
  socketErrors: number;
  presenceRooms: number;
  startedAt: string;
  uptimeSec: number;
};

const startedAt = Date.now();

const counters = {
  connections: 0,
  peakConnections: 0,
  roomJoins: 0,
  roomLeaves: 0,
  typingEvents: 0,
  rateLimited: 0,
  authFailures: 0,
  socketErrors: 0,
};

export function recordConnectionOpen() {
  counters.connections += 1;
  if (counters.connections > counters.peakConnections) {
    counters.peakConnections = counters.connections;
  }
}

export function recordConnectionClose() {
  counters.connections = Math.max(0, counters.connections - 1);
}

export function recordRoomJoin() {
  counters.roomJoins += 1;
}

export function recordRoomLeave() {
  counters.roomLeaves += 1;
}

export function recordTypingEvent() {
  counters.typingEvents += 1;
}

export function recordRateLimited() {
  counters.rateLimited += 1;
}

export function recordAuthFailure() {
  counters.authFailures += 1;
}

export function recordSocketError() {
  counters.socketErrors += 1;
}

export function getRealtimeMetrics(
  presenceRoomCount = 0,
): RealtimeMetricsSnapshot {
  return {
    ...counters,
    presenceRooms: presenceRoomCount,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };
}
