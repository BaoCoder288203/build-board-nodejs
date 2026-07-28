import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import * as meetingController from "./meeting.controller.js";

export const meetingRouter = Router();

meetingRouter.use(requireAuth);

meetingRouter.post("/:meetingId/join", meetingController.join);
meetingRouter.post("/:meetingId/leave", meetingController.leave);
meetingRouter.post("/:meetingId/end", meetingController.end);
