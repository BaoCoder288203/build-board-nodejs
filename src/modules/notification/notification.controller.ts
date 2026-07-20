import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import * as notificationService from "./notification.service.js";
import {
  listNotificationsQuerySchema,
  updateNotificationSettingsSchema,
} from "./notification.schema.js";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listNotificationsQuerySchema, req.query);
    const result = await notificationService.listNotifications(
      req.user.id,
      query,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function unread(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await notificationService.unreadCount(req.user.id);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function markRead(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await notificationService.markAsRead(
      req.user.id,
      param(req, "notificationId"),
    );
    return successResponse(res, result, "Notification marked as read");
  } catch (error) {
    next(error);
  }
}

export async function markAllRead(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await notificationService.markAllAsRead(req.user.id);
    return successResponse(res, result, "All notifications marked as read");
  } catch (error) {
    next(error);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await notificationService.deleteNotification(
      req.user.id,
      param(req, "notificationId"),
    );
    return successResponse(res, null, result.message);
  } catch (error) {
    next(error);
  }
}

export async function getSettings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await notificationService.getSettings(req.user.id);
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function updateSettings(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateNotificationSettingsSchema, req.body);
    const result = await notificationService.updateSettings(req.user.id, body);
    return successResponse(res, result, "Notification settings updated");
  } catch (error) {
    next(error);
  }
}
