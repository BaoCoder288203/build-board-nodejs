import { randomUUID } from "node:crypto";

export function newUnoId() {
  return randomUUID();
}

export function unoSocketRoom(roomId: string) {
  return `uno:room:${roomId}`;
}
