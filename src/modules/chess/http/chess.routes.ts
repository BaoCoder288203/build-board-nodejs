import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import * as roomController from "./chess-room.controller.js";

export const chessRouter = Router();

chessRouter.use(requireAuth);

chessRouter.post("/rooms", roomController.create);
chessRouter.get("/rooms/:roomId", roomController.getOne);
chessRouter.post("/rooms/:roomId/join", roomController.join);
chessRouter.post("/rooms/:roomId/leave", roomController.leave);
chessRouter.post("/rooms/:roomId/invites", roomController.invite);
chessRouter.post("/rooms/:roomId/kick", roomController.kick);
chessRouter.get("/rooms/:roomId/snapshot", roomController.snapshot);
chessRouter.get("/rooms/:roomId/game", roomController.getGame);
chessRouter.post("/rooms/:roomId/rematch", roomController.rematch);
chessRouter.get("/rooms/:roomId/results", roomController.results);
