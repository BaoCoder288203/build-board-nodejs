import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as boardController from "./board.controller.js";

export const boardRouter = Router();

boardRouter.use(requireAuth);

boardRouter.post("/", boardController.create);
boardRouter.get("/", boardController.list);
boardRouter.get("/:boardId", boardController.getOne);
boardRouter.patch("/:boardId", boardController.update);
boardRouter.post("/:boardId/archive", boardController.archive);
boardRouter.delete("/:boardId", boardController.remove);
