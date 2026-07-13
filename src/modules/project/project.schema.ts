import { z } from "zod";

export const createProjectSchema = z.object({
  workspaceId: z.string({ error: "Workspace id is required" }).uuid("Workspace id must be a valid UUID"),
  name: z
    .string({ error: "Project name is required" })
    .trim()
    .min(3, "Project name must be at least 3 characters")
    .max(100, "Project name must be at most 100 characters"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may only contain lowercase letters, numbers, and hyphens")
    .optional(),
  description: z.string().trim().max(1000, "Description must be at most 1000 characters").optional().nullable(),
  visibility: z.enum(["PRIVATE", "WORKSPACE"]).default("WORKSPACE"),
  color: z.string().trim().max(30).optional().nullable(),
  icon: z.string().trim().max(50).optional().nullable(),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(3).max(100).optional(),
  description: z.string().trim().max(1000).optional().nullable(),
  visibility: z.enum(["PRIVATE", "WORKSPACE"]).optional(),
  color: z.string().trim().max(30).optional().nullable(),
  icon: z.string().trim().max(50).optional().nullable(),
});

export const listProjectsQuerySchema = z.object({
  workspaceId: z.string().uuid("Workspace id must be a valid UUID"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
