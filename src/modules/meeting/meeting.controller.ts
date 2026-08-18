import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/app-error.js";
import { param } from "../../common/params.js";
import { successResponse } from "../../common/response.js";
import { parseOrThrow } from "../../common/validation.js";
import { SERVER_EVENT } from "../../realtime/events.js";
import { getRealtimeNamespace, clearMeetingMediaState } from "../../realtime/socket.js";
import { requireUploadedFile } from "../../middleware/upload.js";
import * as meetingService from "./meeting.service.js";
import {
  broadcastMeetingLeave,
  emitMeetingEnded,
  emitMeetingParticipantEvent,
  emitMeetingParticipants,
} from "./meeting.realtime.js";
import { resolveIceServers } from "./webrtc-ice.js";
import {
  createMeetingSchema,
  kickParticipantSchema,
  listMeetingsQuerySchema,
  transferHostSchema,
  updateMyAppearanceSchema,
} from "./meeting.schema.js";

function emitMeetingCreated(input: {
  meeting: {
    id: string;
    boardId: string;
    workspaceId: string;
  };
  participants: unknown[];
  actorId: string;
}) {
  const rt = getRealtimeNamespace();
  if (!rt) return;
  const payload = {
    meeting: input.meeting,
    participants: input.participants,
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
  };
  rt.to(`board:${input.meeting.boardId}`).emit(SERVER_EVENT.MEETING_CREATED, payload);
  rt.to(`workspace:${input.meeting.workspaceId}`).emit(
    SERVER_EVENT.MEETING_CREATED,
    payload,
  );
}

export async function startInBoard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(createMeetingSchema, req.body);
    const result = await meetingService.createMeeting(
      req.user.id,
      param(req, "boardId"),
      body,
    );
    emitMeetingCreated({
      meeting: result.meeting,
      participants: result.participants,
      actorId: req.user.id,
    });
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result.meeting, "Meeting started", 201);
  } catch (error) {
    next(error);
  }
}

export async function activeInBoard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await meetingService.getActiveMeeting(req.user.id, param(req, "boardId"));
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function listInBoard(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const query = parseOrThrow(listMeetingsQuerySchema, req.query);
    const result = await meetingService.listMeetings(
      req.user.id,
      param(req, "boardId"),
      query.page,
      query.limit,
    );
    return successResponse(res, result);
  } catch (error) {
    next(error);
  }
}

export async function join(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await meetingService.joinMeeting(req.user.id, param(req, "meetingId"));
    emitMeetingParticipantEvent(getRealtimeNamespace(), SERVER_EVENT.MEETING_JOINED, {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participant: result.participant,
      actorId: req.user.id,
    });
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result, "Joined meeting");
  } catch (error) {
    next(error);
  }
}

export async function leave(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await meetingService.leaveMeeting(req.user.id, param(req, "meetingId"));
    if (!result.alreadyLeft) {
      broadcastMeetingLeave(getRealtimeNamespace(), result, req.user.id, clearMeetingMediaState);
    }
    return successResponse(
      res,
      {
        newHost: result.newHost,
        ended: Boolean(result.endedMeeting),
      },
      "Left meeting",
    );
  } catch (error) {
    next(error);
  }
}

export async function end(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await meetingService.endMeeting(req.user.id, param(req, "meetingId"));
    clearMeetingMediaState(result.id);
    emitMeetingEnded(getRealtimeNamespace(), {
      meetingId: result.id,
      boardId: result.boardId,
      workspaceId: result.workspaceId,
      endedBy: req.user.id,
    });
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.id,
      boardId: result.boardId,
      workspaceId: result.workspaceId,
      participants: [],
    });
    return successResponse(res, result, "Meeting ended");
  } catch (error) {
    next(error);
  }
}

export async function transferHost(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(transferHostSchema, req.body);
    const result = await meetingService.transferHost(
      req.user.id,
      param(req, "meetingId"),
      body.toUserId,
    );
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result, "Host transferred");
  } catch (error) {
    next(error);
  }
}

export async function kick(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(kickParticipantSchema, req.body);
    const result = await meetingService.kickParticipant(
      req.user.id,
      param(req, "meetingId"),
      body.userId,
    );
    emitMeetingParticipantEvent(getRealtimeNamespace(), SERVER_EVENT.MEETING_LEFT, {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participant: result.participant,
      actorId: req.user.id,
    });
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result, "Participant removed");
  } catch (error) {
    next(error);
  }
}

export async function updateMyAppearance(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const body = parseOrThrow(updateMyAppearanceSchema, req.body);
    const result = await meetingService.updateMyAppearance(
      req.user.id,
      param(req, "meetingId"),
      body,
    );
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result, "Appearance updated");
  } catch (error) {
    next(error);
  }
}

export async function uploadMyBackground(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const file = requireUploadedFile(req.file);
    const result = await meetingService.uploadMyTileBackground(
      req.user.id,
      param(req, "meetingId"),
      file,
    );
    emitMeetingParticipants(getRealtimeNamespace(), {
      meetingId: result.meeting.id,
      boardId: result.meeting.boardId,
      workspaceId: result.meeting.workspaceId,
      participants: result.participants,
    });
    return successResponse(res, result, "Background updated");
  } catch (error) {
    next(error);
  }
}

export async function iceServers(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    const result = await resolveIceServers(req.user.id);
    return successResponse(res, result, "ICE servers");
  } catch (error) {
    next(error);
  }
}
