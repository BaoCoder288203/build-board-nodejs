import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { uploadSingle } from "../../middleware/upload.js";
import * as meetingController from "./meeting.controller.js";

export const meetingRouter = Router();

meetingRouter.use(requireAuth);

meetingRouter.get("/ice-servers", meetingController.iceServers);
meetingRouter.post("/:meetingId/join", meetingController.join);
meetingRouter.post("/:meetingId/leave", meetingController.leave);
meetingRouter.post("/:meetingId/end", meetingController.end);
meetingRouter.post("/:meetingId/transfer-host", meetingController.transferHost);
meetingRouter.post("/:meetingId/kick", meetingController.kick);
meetingRouter.patch("/:meetingId/me", meetingController.updateMyAppearance);
meetingRouter.post(
  "/:meetingId/me/background",
  uploadSingle,
  meetingController.uploadMyBackground,
);
