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
