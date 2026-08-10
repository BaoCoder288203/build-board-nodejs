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

export const updateMyAppearanceSchema = z
  .object({
    displayName: z
      .union([z.string().trim().min(1).max(80), z.literal(""), z.null()])
      .optional(),
    tileBgMode: z.enum(["NONE", "BLUR", "IMAGE"]).optional(),
    tileBgUrl: z.union([z.string().url().max(2000), z.null()]).optional(),
  })
  .refine(
    (v) =>
      v.displayName !== undefined ||
      v.tileBgMode !== undefined ||
      v.tileBgUrl !== undefined,
    { message: "At least one appearance field is required" },
  )
  .superRefine((v, ctx) => {
    if (v.tileBgMode === "IMAGE" && v.tileBgUrl === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tileBgUrl required for IMAGE mode",
        path: ["tileBgUrl"],
      });
    }
  });

export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;
export type ListMeetingsQuery = z.infer<typeof listMeetingsQuerySchema>;
export type TransferHostInput = z.infer<typeof transferHostSchema>;
export type KickParticipantInput = z.infer<typeof kickParticipantSchema>;
export type UpdateMyAppearanceInput = z.infer<typeof updateMyAppearanceSchema>;
