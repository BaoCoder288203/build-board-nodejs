import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { clearAuthCookies, setAuthCookies } from "../../common/cookies.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { requireUploadedFile } from "../../middleware/upload.js";
import * as authService from "./auth.service.js";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from "./auth.schema.js";

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseOrThrow(registerSchema, req.body);
    const result = await authService.register(body);
    return successResponse(res, result, result.message, 201);
  } catch (error) {
    next(error);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseOrThrow(loginSchema, req.body);
    const result = await authService.login(body, authService.requestMeta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    return successResponse(res, result, "Login successful");
  } catch (error) {
    next(error);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseOrThrow(refreshSchema, req.body ?? {});
    const raw =
      body.refreshToken ??
      (req.cookies?.refresh_token as string | undefined);
    const result = await authService.refresh(raw, authService.requestMeta(req));
    setAuthCookies(res, result.accessToken, result.refreshToken);
    return successResponse(res, result, "Token refreshed");
  } catch (error) {
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const raw = req.cookies?.refresh_token as string | undefined;
    const result = await authService.logout(req.user.id, raw);
    clearAuthCookies(res);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function logoutAll(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const result = await authService.logoutAll(req.user.id);
    clearAuthCookies(res);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const body = parseOrThrow(verifyEmailSchema, req.body);
    const result = await authService.verifyEmail(body.token);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseOrThrow(resendVerificationSchema, req.body);
    const result = await authService.resendVerification(body.email);
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseOrThrow(forgotPasswordSchema, req.body);
    const result = await authService.forgotPassword(body.email);
    return successResponse(res, result, result.message);
  } catch (error) {
    next(error);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const body = parseOrThrow(resetPasswordSchema, req.body);
    const result = await authService.resetPassword(body.token, body.password);
    clearAuthCookies(res);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function changePassword(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const body = parseOrThrow(changePasswordSchema, req.body);
    const result = await authService.changePassword(
      req.user.id,
      body.currentPassword,
      body.newPassword,
    );
    clearAuthCookies(res);
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const user = await authService.getMe(req.user.id);
    return successResponse(res, user);
  } catch (error) {
    next(error);
  }
}

export async function updateProfile(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const body = parseOrThrow(updateProfileSchema, req.body);
    const user = await authService.updateProfile(req.user.id, body);
    return successResponse(res, user, "Profile updated");
  } catch (error) {
    next(error);
  }
}

export async function uploadAvatar(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }
    const file = requireUploadedFile(req.file);
    const user = await authService.uploadAvatar(req.user.id, file);
    return successResponse(res, user, "Avatar updated");
  } catch (error) {
    next(error);
  }
}
