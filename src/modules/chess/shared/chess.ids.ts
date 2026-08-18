import { randomUUID } from "node:crypto";

export function newChessId() {
  return randomUUID();
}

export function chessSocketRoom(roomId: string) {
  return `chess:room:${roomId}`;
}
