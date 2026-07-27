import { TaskStatus } from "@prisma/client";
import { z } from "zod";

const uuid = z.string().uuid();

export const dashboardWorkspaceQuerySchema = z.object({
  workspaceId: uuid,
});

export const myTasksQuerySchema = z.object({
  workspaceId: uuid,
  status: z.nativeEnum(TaskStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const upcomingQuerySchema = z.object({
  workspaceId: uuid,
  days: z.coerce.number().int().min(1).max(90).default(14),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type DashboardWorkspaceQuery = z.infer<
  typeof dashboardWorkspaceQuerySchema
>;
export type MyTasksQuery = z.infer<typeof myTasksQuerySchema>;
export type UpcomingQuery = z.infer<typeof upcomingQuerySchema>;
