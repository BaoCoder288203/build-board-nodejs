import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as boardController from "./board.controller.js";
import * as meetingController from "../meeting/meeting.controller.js";

export const boardRouter = Router();

boardRouter.use(requireAuth);

boardRouter.post("/", boardController.create);
boardRouter.get("/", boardController.list);
boardRouter.post("/:boardId/meetings", meetingController.startInBoard);
boardRouter.get("/:boardId/meetings/active", meetingController.activeInBoard);
boardRouter.get("/:boardId/meetings", meetingController.listInBoard);
boardRouter.get("/:boardId", boardController.getOne);
boardRouter.patch("/:boardId", boardController.update);
boardRouter.post("/:boardId/archive", boardController.archive);
boardRouter.post("/:boardId/restore", boardController.restore);
boardRouter.delete("/:boardId", boardController.remove);
