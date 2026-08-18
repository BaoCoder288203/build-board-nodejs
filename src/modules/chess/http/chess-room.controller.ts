import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../../common/app-error.js";
import { param } from "../../../common/params.js";
import { successResponse } from "../../../common/response.js";
import { parseOrThrow } from "../../../common/validation.js";
import * as roomService from "../room/room.service.js";
import * as gameService from "../game/game.service.js";
import { httpInviteAndNotify } from "../socket/chess.gateway.js";
import {
  createChessRoomSchema,
  inviteChessSchema,
  joinChessRoomSchema,
  kickChessSchema,
} from "./chess.schema.js";

function requireUser(req: Request) {
  if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHENTICATED");
  return req.user;
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const body = parseOrThrow(createChessRoomSchema, req.body);
    const room = await roomService.createRoom(user.id, body);
    return successResponse(res, room, "Chess room created", 201);
  } catch (error) {
    next(error);
  }
}

export async function join(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const body = parseOrThrow(joinChessRoomSchema, req.body ?? {});
    const result = await roomService.joinRoom(user.id, param(req, "roomId"), body);
    return successResponse(res, result, "Joined Chess room");
  } catch (error) {
    next(error);
  }
}

export async function leave(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const room = await gameService.leaveGame(user.id, param(req, "roomId"));
    return successResponse(res, room, "Left Chess room");
  } catch (error) {
    next(error);
  }
}

export async function invite(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const body = parseOrThrow(inviteChessSchema, req.body);
    const result = await httpInviteAndNotify(user.id, param(req, "roomId"), body.userIds);
    return successResponse(res, result, "Invites sent");
  } catch (error) {
    next(error);
  }
}

export async function kick(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const body = parseOrThrow(kickChessSchema, req.body);
    const roomId = param(req, "roomId");
    const before = await roomService.getRoom(user.id, roomId);
    await roomService.kickPlayer(user.id, roomId, body.playerId);
    if (before.status === "PLAYING") {
      await gameService.onPlayerLeftMidGame(roomId, body.playerId);
    }
    const room = await roomService.getRoom(user.id, roomId);
    return successResponse(res, room, "Player removed");
  } catch (error) {
    next(error);
  }
}

export async function getOne(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const room = await roomService.getRoom(user.id, param(req, "roomId"));
    return successResponse(res, room);
  } catch (error) {
    next(error);
  }
}

export async function snapshot(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const data = await gameService.snapshot(user.id, param(req, "roomId"));
    return successResponse(res, data);
  } catch (error) {
    next(error);
  }
}

export async function rematch(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const room = await gameService.rematch(
      user.id,
      param(req, "roomId"),
      `http-rematch:${param(req, "roomId")}:${user.id}`,
    );
    return successResponse(res, room, "Rematch ready");
  } catch (error) {
    next(error);
  }
}

export async function getGame(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const data = await gameService.snapshot(user.id, param(req, "roomId"));
    if (!data.game) {
      throw new AppError("Game not found", 404, "GAME_NOT_FOUND");
    }
    return successResponse(res, data.game);
  } catch (error) {
    next(error);
  }
}

export async function results(req: Request, res: Response, next: NextFunction) {
  try {
    const user = requireUser(req);
    const data = await gameService.listHistory(user.id, param(req, "roomId"));
    return successResponse(res, data);
  } catch (error) {
    next(error);
  }
}
