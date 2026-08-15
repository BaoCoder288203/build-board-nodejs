import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import * as roomController from "./uno-room.controller.js";
import * as historyController from "./uno-history.controller.js";

export const unoRouter = Router();

unoRouter.use(requireAuth);

unoRouter.post("/rooms", roomController.create);
unoRouter.get("/rooms/:roomId", roomController.getOne);
unoRouter.post("/rooms/:roomId/join", roomController.join);
unoRouter.post("/rooms/:roomId/leave", roomController.leave);
unoRouter.post("/rooms/:roomId/invites", roomController.invite);
unoRouter.post("/rooms/:roomId/kick", roomController.kick);
unoRouter.get("/rooms/:roomId/snapshot", roomController.snapshot);
unoRouter.get("/rooms/:roomId/game", roomController.getGame);
unoRouter.post("/rooms/:roomId/rematch", roomController.rematch);
unoRouter.get("/rooms/:roomId/results", historyController.results);
