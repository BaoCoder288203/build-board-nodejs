import { AppError } from "../../../common/app-error.js";
import { CONNECTION_STATUS, END_REASON, ROOM_STATUS } from "../shared/chess.enums.js";
import { CHESS_ERROR } from "../shared/chess.errors.js";
import * as gameService from "../game/game.service.js";
import * as roomRepo from "../persistence/chess-room.repository.js";
import * as roomService from "../room/room.service.js";
import { ensureRuntime } from "../session/chess-session.store.js";
import { emitPlayerLeft } from "../socket/chess.broadcaster.js";

function clearDisconnectTimer(roomId: string, userId: string) {
  const runtime = ensureRuntime(roomId);
  const timer = runtime.disconnectTimers.get(userId);
  if (!timer) return;
  clearTimeout(timer);
  runtime.disconnectTimers.delete(userId);
}

export async function leaveChessForMeetingUser(userId: string, meetingId: string) {
  const room = await roomRepo.findActiveRoomForMeeting(meetingId);
  if (!room || room.status === ROOM_STATUS.CLOSED) return;

  const player = room.players.find((p) => p.userId === userId);
  if (!player || player.connectionStatus === CONNECTION_STATUS.LEFT) return;

  clearDisconnectTimer(room.id, userId);

  try {
    const next = await gameService.leaveGame(userId, room.id);
    emitPlayerLeft(next, player.id, userId);
  } catch (error) {
    if (error instanceof AppError && error.code === CHESS_ERROR.NOT_ROOM_MEMBER) return;
    throw error;
  }
}

export async function abortChessForMeeting(meetingId: string) {
  const room = await roomRepo.findActiveRoomForMeeting(meetingId);
  if (!room || room.status === ROOM_STATUS.CLOSED) return;

  if (room.status === ROOM_STATUS.PLAYING) {
    await gameService.abortGame(room.id, END_REASON.HOST_CLOSED);
  }

  const latest = await roomRepo.findRoomById(room.id);
  const players = latest?.players ?? room.players;
  for (const player of players) {
    if (player.connectionStatus === CONNECTION_STATUS.LEFT) continue;
    clearDisconnectTimer(room.id, player.userId);
    try {
      const next = await roomService.leaveRoom(player.userId, room.id);
      emitPlayerLeft(next, player.id, player.userId);
    } catch (error) {
      if (error instanceof AppError && error.code === CHESS_ERROR.NOT_ROOM_MEMBER) continue;
      throw error;
    }
  }
}
