import { ActivityAction, ActivityEntityType } from "@prisma/client";
import { z } from "zod";

const uuid = z.string().uuid();

export const listActivitiesQuerySchema = z.object({
  workspaceId: uuid,
  projectId: uuid.optional(),
  boardId: uuid.optional(),
  taskId: uuid.optional(),
  userId: uuid.optional(),
  entityType: z.nativeEnum(ActivityEntityType).optional(),
  action: z.nativeEnum(ActivityAction).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const timelineQuerySchema = z.object({
  workspaceId: uuid,
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

export const searchActivitiesQuerySchema = z.object({
  workspaceId: uuid,
  keyword: z.string().trim().min(1).max(100).optional(),
  entityType: z.nativeEnum(ActivityEntityType).optional(),
  action: z.nativeEnum(ActivityAction).optional(),
  actorId: uuid.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListActivitiesQuery = z.infer<typeof listActivitiesQuerySchema>;
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
export type SearchActivitiesQuery = z.infer<typeof searchActivitiesQuerySchema>;
