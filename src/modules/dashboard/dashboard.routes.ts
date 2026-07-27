import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as dashboardController from "./dashboard.controller.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

dashboardRouter.get("/summary", dashboardController.summary);
dashboardRouter.get("/my-tasks", dashboardController.myTasks);
dashboardRouter.get("/upcoming", dashboardController.upcoming);
