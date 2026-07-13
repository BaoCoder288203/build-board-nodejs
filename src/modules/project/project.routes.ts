import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as projectController from "./project.controller.js";

export const projectRouter = Router();

projectRouter.use(requireAuth);

projectRouter.post("/", projectController.create);
projectRouter.get("/", projectController.list);
projectRouter.get("/:projectId", projectController.getOne);
projectRouter.patch("/:projectId", projectController.update);
projectRouter.post("/:projectId/archive", projectController.archive);
projectRouter.delete("/:projectId", projectController.remove);
