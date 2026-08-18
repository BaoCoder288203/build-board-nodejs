import { z } from "zod";
import { ROOM_CONTEXT } from "../shared/chess.enums.js";

export const createChessRoomSchema = z.object({
  contextType: z.enum([
    ROOM_CONTEXT.MEETING,
    ROOM_CONTEXT.BOARD,
    ROOM_CONTEXT.WORKSPACE,
  ]),
  meetingId: z.string().uuid().optional(),
  boardId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  allowSpectator: z.boolean().optional(),
});

export const joinChessRoomSchema = z.object({
  asSpectator: z.boolean().optional(),
});

export const inviteChessSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(8),
});

export const kickChessSchema = z.object({
  playerId: z.string().uuid(),
});

export const chessMovePayloadSchema = z.object({
  from: z.string().regex(/^[a-h][1-8]$/),
  to: z.string().regex(/^[a-h][1-8]$/),
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});
