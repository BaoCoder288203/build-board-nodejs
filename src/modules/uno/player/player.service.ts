import * as roomService from "../room/room.service.js";

export async function setReady(userId: string, roomId: string, ready: boolean) {
  return roomService.setReady(userId, roomId, ready);
}
