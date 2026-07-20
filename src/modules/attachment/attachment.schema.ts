import { z } from "zod";

export const uploadAttachmentFieldsSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    commentId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    const hasTask = Boolean(v.taskId);
    const hasComment = Boolean(v.commentId);
    if (hasTask === hasComment) {
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of taskId or commentId",
        path: ["taskId"],
      });
    }
  });

export const listAttachmentsQuerySchema = z
  .object({
    taskId: z.string().uuid().optional(),
    commentId: z.string().uuid().optional(),
  })
  .refine((q) => Boolean(q.taskId) !== Boolean(q.commentId), {
    message: "Provide exactly one of taskId or commentId",
  });

export type UploadAttachmentFields = z.infer<
  typeof uploadAttachmentFieldsSchema
>;
