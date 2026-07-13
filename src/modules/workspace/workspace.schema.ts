import { z } from "zod";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const createWorkspaceSchema = z.object({
  name: z
    .string({ error: "Workspace name is required" })
    .trim()
    .min(3, "Workspace name must be at least 3 characters")
    .max(100, "Workspace name must be at most 100 characters"),
  slug: z
    .string({ error: "Workspace slug is required" })
    .trim()
    .toLowerCase()
    .min(3, "Slug must be at least 3 characters")
    .max(100, "Slug must be at most 100 characters")
    .regex(slugRegex, "Slug may only contain lowercase letters, numbers, and hyphens"),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .nullable(),
});

export const updateWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, "Workspace name must be at least 3 characters")
    .max(100, "Workspace name must be at most 100 characters")
    .optional(),
  description: z
    .string()
    .trim()
    .max(500, "Description must be at most 500 characters")
    .optional()
    .nullable(),
  timezone: z.string().trim().max(100).optional().nullable(),
});

export const inviteMemberSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email("Enter a valid email address")
    .max(255),
  roleId: z.string({ error: "Role is required" }).uuid("Role id must be a valid UUID"),
});

export const invitationTokenSchema = z.object({
  token: z.string({ error: "Invitation token is required" }).min(1, "Invitation token is required"),
});

export const changeMemberRoleSchema = z.object({
  roleId: z.string({ error: "Role is required" }).uuid("Role id must be a valid UUID"),
});

export const transferOwnerSchema = z.object({
  memberId: z
    .string({ error: "Member id is required" })
    .uuid("Member id must be a valid UUID"),
});

export const updateSettingsSchema = z.object({
  allowGuest: z.boolean().optional(),
  allowPublicProject: z.boolean().optional(),
  allowAi: z.boolean().optional(),
  allowFileUpload: z.boolean().optional(),
  defaultLanguage: z.string().trim().max(20).optional(),
  defaultTimezone: z.string().trim().max(100).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
