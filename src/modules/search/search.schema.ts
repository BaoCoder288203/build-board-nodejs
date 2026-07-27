import { TaskPriority, TaskStatus } from "@prisma/client";
import { z } from "zod";

const uuid = z.string().uuid();

export const globalSearchQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(100),
  workspaceId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export const searchTasksQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(100).optional(),
  workspaceId: uuid,
  projectId: uuid.optional(),
  boardId: uuid.optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  sortBy: z.enum(["updatedAt", "dueDate", "title", "createdAt"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type GlobalSearchQuery = z.infer<typeof globalSearchQuerySchema>;
export type SearchTasksQuery = z.infer<typeof searchTasksQuerySchema>;
