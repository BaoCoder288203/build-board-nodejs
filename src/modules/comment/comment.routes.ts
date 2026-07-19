import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as commentController from "./comment.controller.js";

export const commentRouter = Router();

commentRouter.use(requireAuth);

commentRouter.get("/", commentController.list);
commentRouter.post("/", commentController.create);
commentRouter.patch("/:commentId", commentController.update);
commentRouter.delete("/:commentId", commentController.remove);
commentRouter.post("/:commentId/replies", commentController.reply);
commentRouter.get("/:commentId/replies", commentController.listReplies);
