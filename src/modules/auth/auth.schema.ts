import { z } from "zod";

export const passwordSchema = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-z]/, "Password must include a lowercase letter")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number")
  .regex(/[^A-Za-z0-9]/, "Password must include a special character");

export const registerSchema = z.object({
  fullName: z
    .string({ error: "Full name is required" })
    .trim()
    .min(2, "Full name must be at least 2 characters")
    .max(100, "Full name must be at most 100 characters"),
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email("Enter a valid email address")
    .max(255, "Email must be at most 255 characters"),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email("Enter a valid email address"),
  password: z
    .string({ error: "Password is required" })
    .min(1, "Password is required"),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required").optional(),
});

export const verifyEmailSchema = z.object({
  token: z.string({ error: "Verification token is required" }).min(1, "Verification token is required"),
});

export const resendVerificationSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email("Enter a valid email address"),
});

export const forgotPasswordSchema = z.object({
  email: z
    .string({ error: "Email is required" })
    .trim()
    .email("Enter a valid email address"),
});

export const resetPasswordSchema = z.object({
  token: z.string({ error: "Reset token is required" }).min(1, "Reset token is required"),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: "Current password is required" })
    .min(1, "Current password is required"),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
