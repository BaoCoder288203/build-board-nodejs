import * as gameService from "../game/game.service.js";
import * as resultRepo from "../persistence/uno-result.repository.js";
import { unoError, UNO_ERROR } from "../shared/uno.errors.js";
import * as roomRepo from "../persistence/uno-room.repository.js";
import { getWorkspaceMembership } from "../../../common/access.js";

export async function getSnapshot(userId: string, roomId: string) {
  return gameService.snapshot(userId, roomId);
}

export async function listHistory(userId: string, roomId: string) {
  const room = await roomRepo.findRoomById(roomId);
  if (!room) throw unoError(UNO_ERROR.ROOM_NOT_FOUND);
  await getWorkspaceMembership(userId, room.workspaceId);
  const rows = await resultRepo.listResults(roomId);
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.sessionId,
    scores: row.scores,
    winnerId: row.winnerId,
    createdAt: row.createdAt.toISOString(),
    roundNumber: row.session.roundNumber,
    endReason: row.session.endReason,
  }));
}
