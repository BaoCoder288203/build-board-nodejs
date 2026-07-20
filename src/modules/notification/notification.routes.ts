import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as notificationController from "./notification.controller.js";

export const notificationRouter = Router();

notificationRouter.use(requireAuth);

notificationRouter.get("/settings", notificationController.getSettings);
notificationRouter.patch("/settings", notificationController.updateSettings);
notificationRouter.get("/unread-count", notificationController.unread);
notificationRouter.patch("/read-all", notificationController.markAllRead);
notificationRouter.get("/", notificationController.list);
notificationRouter.patch(
  "/:notificationId/read",
  notificationController.markRead,
);
notificationRouter.delete(
  "/:notificationId",
  notificationController.remove,
);
