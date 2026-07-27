import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as searchController from "./search.controller.js";

export const searchRouter = Router();

searchRouter.use(requireAuth);

searchRouter.get("/", searchController.global);
searchRouter.get("/tasks", searchController.tasks);
