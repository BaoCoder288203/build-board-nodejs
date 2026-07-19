import { z } from "zod";

const uuid = (label: string) =>
  z.string({ error: `${label} is required` }).uuid(`${label} must be a valid UUID`);

export const createChecklistSchema = z.object({
  taskId: uuid("Task id"),
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(2, "Title must be at least 2 characters")
    .max(150, "Title must be at most 150 characters"),
});

export const updateChecklistSchema = z.object({
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(2, "Title must be at least 2 characters")
    .max(150, "Title must be at most 150 characters"),
});

export const listChecklistsQuerySchema = z.object({
  taskId: uuid("Task id"),
});

export const createChecklistItemSchema = z.object({
  title: z
    .string({ error: "Title is required" })
    .trim()
    .min(1, "Title is required")
    .max(500, "Title must be at most 500 characters"),
});

export const updateChecklistItemSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    completed: z.boolean().optional(),
  })
  .refine((b) => b.title !== undefined || b.completed !== undefined, {
    message: "title or completed is required",
  });

export const completeChecklistItemSchema = z.object({
  completed: z.boolean({ error: "completed is required" }),
});

export const reorderChecklistItemsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().uuid(),
        position: z.number().int().min(0),
      }),
    )
    .min(1, "items must not be empty"),
});

export type CreateChecklistInput = z.infer<typeof createChecklistSchema>;
export type UpdateChecklistInput = z.infer<typeof updateChecklistSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
export type ReorderChecklistItemsInput = z.infer<
  typeof reorderChecklistItemsSchema
>;
