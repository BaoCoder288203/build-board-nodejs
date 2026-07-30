import { z } from "zod";

export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
});

export const listMeetingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const transferHostSchema = z.object({
  toUserId: z.string().uuid(),
});

export const kickParticipantSchema = z.object({
  userId: z.string().uuid(),
});

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
export type TransferHostInput = z.infer<typeof transferHostSchema>;
export type KickParticipantInput = z.infer<typeof kickParticipantSchema>;
