import { z } from "zod";
import { ROOM_CONTEXT } from "../shared/uno.enums.js";

export const createUnoRoomSchema = z.object({
  contextType: z.enum([
    ROOM_CONTEXT.MEETING,
    ROOM_CONTEXT.BOARD,
    ROOM_CONTEXT.WORKSPACE,
  ]),
  meetingId: z.string().uuid().optional(),
  boardId: z.string().uuid().optional(),
  workspaceId: z.string().uuid().optional(),
  maxPlayers: z.number().int().min(2).max(6).optional(),
  allowSpectator: z.boolean().optional(),
  rules: z
    .object({
      targetScore: z.number().int().min(1).max(5000).optional(),
      stacking: z.boolean().optional(),
      jumpIn: z.boolean().optional(),
      sevenZero: z.boolean().optional(),
      drawUntilPlayable: z.boolean().optional(),
      forcePlay: z.boolean().optional(),
      allowChallenge: z.boolean().optional(),
      initialHandSize: z.number().int().min(1).max(15).optional(),
      autoStartNextRound: z.boolean().optional(),
      unoPenaltyDraw: z.number().int().min(1).max(10).optional(),
      turnTimerEnabled: z.boolean().optional(),
      challengePenalty: z.number().int().min(1).max(10).optional(),
    })
    .optional(),
});

export const joinUnoRoomSchema = z.object({
  asSpectator: z.boolean().optional(),
});

export const inviteUnoSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(8),
});

export const kickUnoSchema = z.object({
  playerId: z.string().uuid(),
});
