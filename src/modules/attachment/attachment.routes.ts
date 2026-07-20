import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { uploadSingle } from "../../middleware/upload.js";
import * as attachmentController from "./attachment.controller.js";

export const attachmentRouter = Router();

attachmentRouter.use(requireAuth);

attachmentRouter.get("/", attachmentController.list);
attachmentRouter.post("/", uploadSingle, attachmentController.upload);
attachmentRouter.get("/:attachmentId", attachmentController.getOne);
attachmentRouter.delete("/:attachmentId", attachmentController.remove);
attachmentRouter.get(
  "/:attachmentId/download",
  attachmentController.download,
);
attachmentRouter.get("/:attachmentId/preview", attachmentController.preview);
