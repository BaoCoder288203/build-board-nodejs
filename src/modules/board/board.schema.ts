import { z } from "zod";

export const createBoardSchema = z.object({
  projectId: z.string({ error: "Project id is required" }).uuid("Project id must be a valid UUID"),
  name: z
    .string({ error: "Board name is required" })
    .trim()
    .min(3, "Board name must be at least 3 characters")
    .max(100, "Board name must be at most 100 characters"),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
  icon: z.string().trim().max(50).optional().nullable(),
});

export const updateBoardSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
  icon: z.string().trim().max(50).optional().nullable(),
});

export const listBoardsQuerySchema = z.object({
  projectId: z.string().uuid("Project id must be a valid UUID"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
