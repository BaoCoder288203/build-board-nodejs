import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as activityController from "./activity.controller.js";

export const activityRouter = Router();

activityRouter.use(requireAuth);

activityRouter.get("/timeline", activityController.timeline);
activityRouter.get("/search", activityController.search);
activityRouter.get("/", activityController.list);
activityRouter.get("/:activityId", activityController.detail);
