import { z } from "zod";

export const createColumnSchema = z.object({
  boardId: z.string({ error: "Board id is required" }).uuid("Board id must be a valid UUID"),
  name: z
    .string({ error: "Column name is required" })
    .trim()
    .min(2, "Column name must be at least 2 characters")
    .max(100, "Column name must be at most 100 characters"),
  color: z.string().trim().max(30).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  taskLimit: z.number().int().min(0).optional().nullable(),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  color: z.string().trim().max(30).optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  taskLimit: z.number().int().min(0).optional().nullable(),
  isDone: z.boolean().optional(),
});

export const listColumnsQuerySchema = z.object({
  boardId: z.string().uuid("Board id must be a valid UUID"),
});

export const reorderColumnsSchema = z.object({
  boardId: z.string().uuid("Board id must be a valid UUID"),
  columnIds: z
    .array(z.string().uuid())
    .min(1, "At least one column id is required"),
});

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type ReorderColumnsInput = z.infer<typeof reorderColumnsSchema>;
