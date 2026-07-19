import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as columnController from "./column.controller.js";

export const columnRouter = Router();

columnRouter.use(requireAuth);

columnRouter.post("/", columnController.create);
columnRouter.get("/", columnController.list);
columnRouter.post("/reorder", columnController.reorder);
columnRouter.patch("/:columnId", columnController.update);
columnRouter.delete("/:columnId", columnController.remove);
columnRouter.post("/:columnId/copy", columnController.copy);
columnRouter.post("/:columnId/move", columnController.move);
columnRouter.post("/:columnId/move-tasks", columnController.moveTasks);
columnRouter.post("/:columnId/sort", columnController.sort);
columnRouter.post("/:columnId/archive", columnController.archive);
