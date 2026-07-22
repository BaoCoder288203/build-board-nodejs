import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as taskController from "./task.controller.js";

export const taskRouter = Router();

taskRouter.use(requireAuth);

taskRouter.get("/labels", taskController.listLabels);
taskRouter.post("/labels", taskController.createLabel);
taskRouter.delete("/labels/:labelId", taskController.deleteLabelDef);
taskRouter.post("/", taskController.create);
taskRouter.get("/", taskController.list);
taskRouter.get("/:taskId", taskController.getOne);
taskRouter.patch("/:taskId", taskController.update);
taskRouter.delete("/:taskId", taskController.remove);
taskRouter.patch("/:taskId/move", taskController.move);
taskRouter.post("/:taskId/assignees", taskController.assign);
taskRouter.delete("/:taskId/assignees", taskController.unassign);
taskRouter.post("/:taskId/labels", taskController.addLabel);
taskRouter.delete("/:taskId/labels/:labelId", taskController.removeLabel);
