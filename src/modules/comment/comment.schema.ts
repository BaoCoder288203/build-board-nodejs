import { z } from "zod";

const uuid = (label: string) =>
  z.string({ error: `${label} is required` }).uuid(`${label} must be a valid UUID`);

export const createCommentSchema = z.object({
  taskId: uuid("Task id"),
  content: z
    .string({ error: "Content is required" })
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be at most 5000 characters"),
  /** User IDs to mention (resolved to workspace members). */
  mentions: z.array(z.string().uuid()).optional(),
});

export const updateCommentSchema = z.object({
  content: z
    .string({ error: "Content is required" })
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be at most 5000 characters"),
  mentions: z.array(z.string().uuid()).optional(),
});

export const replyCommentSchema = z.object({
  content: z
    .string({ error: "Content is required" })
    .trim()
    .min(1, "Content is required")
    .max(5000, "Content must be at most 5000 characters"),
  mentions: z.array(z.string().uuid()).optional(),
});

export const listCommentsQuerySchema = z.object({
  taskId: uuid("Task id"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ReplyCommentInput = z.infer<typeof replyCommentSchema>;
