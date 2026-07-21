import * as argon2 from "argon2";
import { ActivityAction } from "@prisma/client";
import type { Request } from "express";
import { AppError } from "../../common/app-error.js";
import { env } from "../../config/env.js";
import { prisma } from "../../database/prisma.js";
import { logAuthActivity } from "../activity/activity.service.js";
import {
  resetPasswordEmailHtml,
  sendEmail,
  verificationEmailHtml,
} from "../../providers/email.provider.js";
import {
  generateOpaqueToken,
  getAccessTokenExpiresInSeconds,
  getRefreshTokenExpiresAt,
  hashToken,
  signAccessToken,
} from "../../utils/token.js";
import type { LoginInput, RegisterInput } from "./auth.schema.js";

function publicUser(user: {
  id: string;
  email: string;
  fullName: string;
  username: string;
  avatarUrl: string | null;
  isVerified: boolean;
  isActive: boolean;
}) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    username: user.username,
    avatar: user.avatarUrl,
    isVerified: user.isVerified,
    isActive: user.isActive,
  };
}

async function uniqueUsernameFromEmail(email: string) {
  const base = email
    .split("@")[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 24) || "user";

  let candidate = base;
  let i = 0;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    i += 1;
    candidate = `${base}${i}`;
  }
  return candidate;
}

async function issueTokens(
  user: { id: string; email: string },
  meta?: { ip?: string; userAgent?: string },
) {
  const accessToken = signAccessToken(user.id, user.email);
  const refreshToken = generateOpaqueToken();
  const tokenHash = hashToken(refreshToken);

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      token: tokenHash,
      expiresAt: getRefreshTokenExpiresAt(),
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  await prisma.session.create({
    data: {
      userId: user.id,
      ipAddress: meta?.ip,
      browser: meta?.userAgent?.slice(0, 100),
      lastActivityAt: new Date(),
    },
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: getAccessTokenExpiresInSeconds(),
  };
}

export async function register(input: RegisterInput) {
  if (!env.ENABLE_SIGNUP) {
    throw new AppError("Sign up is disabled", 403, "SIGNUP_DISABLED");
  }

  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError("Email already exists", 409, "EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await argon2.hash(input.password);
  const username = await uniqueUsernameFromEmail(email);

  const user = await prisma.user.create({
    data: {
      email,
      fullName: input.fullName,
      username,
      passwordHash,
      isActive: true,
      isVerified: false,
      notificationSettings: { create: {} },
    },
  });

  const rawToken = generateOpaqueToken(32);
  await prisma.emailVerification.create({
    data: {
      userId: user.id,
      token: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const verifyUrl = `${env.CORS_ORIGIN}/verify-email?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your BuildBoard email",
    html: verificationEmailHtml(user.fullName, verifyUrl),
  });

  return {
    message: "Account created successfully. Please verify your email.",
    ...(env.NODE_ENV === "development" ? { debugToken: rawToken } : {}),
  };
}

export async function login(
  input: LoginInput,
  meta?: { ip?: string; userAgent?: string },
) {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.deletedAt) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  const valid = await argon2.verify(user.passwordHash, input.password);
  if (!valid) {
    throw new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");
  }

  if (!user.isActive) {
    throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
  }

  if (!user.isVerified) {
    throw new AppError("Email is not verified", 403, "EMAIL_NOT_VERIFIED");
  }

  const tokens = await issueTokens(user, meta);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  void logAuthActivity({
    userId: user.id,
    action: ActivityAction.LOGIN,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
  }).catch(() => {});

  return {
    ...tokens,
    user: publicUser(user),
  };
}

export async function refresh(
  rawRefreshToken: string | undefined,
  meta?: { ip?: string; userAgent?: string },
) {
  if (!rawRefreshToken) {
    throw new AppError("Refresh token required", 401, "UNAUTHORIZED");
  }

  const tokenHash = hashToken(rawRefreshToken);
  const stored = await prisma.refreshToken.findUnique({
    where: { token: tokenHash },
    include: { user: true },
  });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw new AppError("Invalid refresh token", 401, "INVALID_REFRESH_TOKEN");
  }

  if (!stored.user.isActive || stored.user.deletedAt) {
    throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  const tokens = await issueTokens(stored.user, meta);
  return tokens;
}

export async function logout(userId: string, rawRefreshToken?: string) {
  if (rawRefreshToken) {
    const tokenHash = hashToken(rawRefreshToken);
    await prisma.refreshToken.updateMany({
      where: { userId, token: tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } else {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  void logAuthActivity({
    userId,
    action: ActivityAction.LOGOUT,
  }).catch(() => {});

  return { message: "Logged out successfully" };
}

export async function logoutAll(userId: string) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return { message: "Logged out from all devices" };
}

export async function verifyEmail(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.emailVerification.findUnique({
    where: { token: tokenHash },
  });

  if (!record || record.verifiedAt || record.expiresAt < new Date()) {
    throw new AppError("Invalid or expired verification token", 400, "INVALID_TOKEN");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { isVerified: true },
    }),
    prisma.emailVerification.update({
      where: { id: record.id },
      data: { verifiedAt: new Date() },
    }),
  ]);

  return { message: "Email verified successfully" };
}

export async function resendVerification(emailRaw: string) {
  const email = emailRaw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  // Avoid user enumeration
  if (!user || user.isVerified) {
    return { message: "If the account exists, a verification email was sent" };
  }

  const rawToken = generateOpaqueToken(32);
  await prisma.emailVerification.create({
    data: {
      userId: user.id,
      token: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const verifyUrl = `${env.CORS_ORIGIN}/verify-email?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Verify your BuildBoard email",
    html: verificationEmailHtml(user.fullName, verifyUrl),
  });

  return {
    message: "If the account exists, a verification email was sent",
    ...(env.NODE_ENV === "development" ? { debugToken: rawToken } : {}),
  };
}

export async function forgotPassword(emailRaw: string) {
  const email = emailRaw.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.deletedAt) {
    return { message: "If the account exists, a reset email was sent" };
  }

  const rawToken = generateOpaqueToken(32);
  await prisma.passwordReset.create({
    data: {
      userId: user.id,
      token: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  const resetUrl = `${env.CORS_ORIGIN}/reset-password?token=${rawToken}`;
  await sendEmail({
    to: user.email,
    subject: "Reset your BuildBoard password",
    html: resetPasswordEmailHtml(user.fullName, resetUrl),
  });

  return {
    message: "If the account exists, a reset email was sent",
    ...(env.NODE_ENV === "development" ? { debugToken: rawToken } : {}),
  };
}

export async function resetPassword(rawToken: string, password: string) {
  const tokenHash = hashToken(rawToken);
  const record = await prisma.passwordReset.findUnique({
    where: { token: tokenHash },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new AppError("Invalid or expired reset token", 400, "INVALID_TOKEN");
  }

  const passwordHash = await argon2.hash(password);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash },
    }),
    prisma.passwordReset.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: "Password reset successfully" };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await argon2.verify(user.passwordHash, currentPassword);
  if (!valid) {
    throw new AppError("Current password is incorrect", 400, "INVALID_PASSWORD");
  }

  const passwordHash = await argon2.hash(newPassword);
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return { message: "Password changed successfully. Please login again." };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) {
    throw new AppError("User not found", 404, "USER_NOT_FOUND");
  }
  return publicUser(user);
}

export function requestMeta(req: Request) {
  return {
    ip: req.ip,
    userAgent: req.get("user-agent") ?? undefined,
  };
}
