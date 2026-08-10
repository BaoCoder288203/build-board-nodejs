import {
  ActivityAction,
  ActivityEntityType,
  MeetingTileBgMode,
  NotificationEntityType,
  NotificationType,
  MeetingStatus,
} from "@prisma/client";
import { getAccessibleProject } from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { notifyMany } from "../../common/notify.js";
import { uploadBuffer } from "../../common/storage.js";
import { prisma } from "../../database/prisma.js";
import type {
  CreateMeetingInput,
  UpdateMyAppearanceInput,
} from "./meeting.schema.js";

const participantInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
    },
  },
} as const;

function publicParticipant(participant: {
  userId: string;
  isHost: boolean;
  displayName: string | null;
  tileBgMode: MeetingTileBgMode;
  tileBgUrl: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  user: { id: string; fullName: string; avatarUrl: string | null };
}) {
  const customName = participant.displayName?.trim() || null;
  const displayName = customName || participant.user.fullName;
  return {
    userId: participant.userId,
    fullName: displayName,
    accountName: participant.user.fullName,
    displayName: customName,
    avatar: participant.user.avatarUrl,
    isHost: participant.isHost,
    tileBgMode: participant.tileBgMode,
    tileBgUrl: participant.tileBgUrl,
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
  };
}

async function getBoardAccess(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    include: {
      project: {
        select: {
          id: true,
          workspaceId: true,
        },
      },
    },
  });
  if (!board || board.project == null) {
    throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
  }
  const projectAccess = await getAccessibleProject(userId, board.project.id);
  return { board, projectAccess };
}

function publicMeeting(
  meeting: {
    id: string;
    boardId: string;
    workspaceId: string;
    createdBy: string;
    title: string | null;
    status: MeetingStatus;
    startedAt: Date;
    endedAt: Date | null;
    participants?: Array<Parameters<typeof publicParticipant>[0]>;
  },
) {
  return {
    id: meeting.id,
    meetingId: meeting.id,
    boardId: meeting.boardId,
    workspaceId: meeting.workspaceId,
    createdBy: meeting.createdBy,
    title: meeting.title,
    status: meeting.status,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    participants: meeting.participants?.map(publicParticipant) ?? [],
  };
}

export async function createMeeting(
  userId: string,
  boardId: string,
  input: CreateMeetingInput,
) {
  const { board, projectAccess } = await getBoardAccess(userId, boardId);
  const existing = await prisma.meeting.findFirst({
    where: { boardId, status: MeetingStatus.ACTIVE },
  });

  if (existing) {
    throw new AppError(
      "This board already has an active meeting",
      409,
      "MEETING_ALREADY_ACTIVE",
    );
  }

  const created = await prisma.meeting.create({
    data: {
      boardId: board.id,
      workspaceId: board.project.workspaceId,
      createdBy: userId,
      title: input.title?.trim() || null,
      status: MeetingStatus.ACTIVE,
      participants: {
        create: {
          userId,
          isHost: true,
          joinedAt: new Date(),
          leftAt: null,
        },
      },
    },
    include: {
      participants: {
        include: participantInclude,
      },
    },
  });

  await prisma.activity.create({
    data: {
      workspaceId: board.project.workspaceId,
      projectId: board.project.id,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: board.id,
      action: ActivityAction.UPDATE,
      metadata: {
        type: "meeting_created",
        meetingId: created.id,
        boardId: board.id,
      },
      afterData: {
        meetingId: created.id,
        status: created.status,
      },
    },
  });

  const [actor, members] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { fullName: true },
    }),
    prisma.workspaceMember.findMany({
      where: { workspaceId: board.project.workspaceId },
      select: { userId: true },
    }),
  ]);
  const actorName = actor?.fullName ?? "A teammate";
  const recipients = members.map((m) => m.userId).filter((id) => id !== userId);
  if (recipients.length) {
    await notifyMany(
      recipients.map((recipientId) => ({
        workspaceId: board.project.workspaceId,
        recipientId,
        senderId: userId,
        entityType: NotificationEntityType.BOARD,
        entityId: board.id,
        notificationType: NotificationType.SYSTEM,
        title: "Board meeting started",
        message: `${actorName} started a meeting in ${board.name}.`,
        metadata: {
          meetingId: created.id,
          boardId: board.id,
          type: "meeting_invite",
        },
      })),
    );
  }

  return {
    meeting: publicMeeting(created),
    participants: created.participants.map(publicParticipant),
    canManageProject: projectAccess.canManageProject,
  };
}

export async function getActiveMeeting(userId: string, boardId: string) {
  await getBoardAccess(userId, boardId);
  const meeting = await prisma.meeting.findFirst({
    where: {
      boardId,
      status: MeetingStatus.ACTIVE,
    },
    include: {
      participants: {
        where: { leftAt: null },
        include: participantInclude,
        orderBy: { joinedAt: "asc" },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  if (!meeting) return null;
  return publicMeeting(meeting);
}

export async function listMeetings(
  userId: string,
  boardId: string,
  page: number,
  limit: number,
) {
  await getBoardAccess(userId, boardId);
  const skip = (page - 1) * limit;

  const [total, items] = await Promise.all([
    prisma.meeting.count({ where: { boardId } }),
    prisma.meeting.findMany({
      where: { boardId },
      skip,
      take: limit,
      orderBy: { startedAt: "desc" },
      include: {
        participants: {
          include: participantInclude,
          orderBy: { joinedAt: "asc" },
        },
      },
    }),
  ]);

  return {
    items: items.map(publicMeeting),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function joinMeeting(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId },
    include: {
      board: {
        include: {
          project: {
            select: { id: true, workspaceId: true },
          },
        },
      },
    },
  });
  if (!meeting || meeting.board.deletedAt || !meeting.board.project) {
    throw new AppError("Meeting not found", 404, "MEETING_NOT_FOUND");
  }
  if (meeting.status !== MeetingStatus.ACTIVE) {
    throw new AppError("Meeting is no longer active", 409, "MEETING_NOT_ACTIVE");
  }

  await getAccessibleProject(userId, meeting.board.project.id);

  const participant = await prisma.meetingParticipant.upsert({
    where: {
      meetingId_userId: {
        meetingId: meeting.id,
        userId,
      },
    },
    create: {
      meetingId: meeting.id,
      userId,
      isHost: false,
      joinedAt: new Date(),
      leftAt: null,
    },
    update: {
      leftAt: null,
    },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
    },
  });

  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  await prisma.activity.create({
    data: {
      workspaceId: meeting.board.project.workspaceId,
      projectId: meeting.board.project.id,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: meeting.board.id,
      action: ActivityAction.UPDATE,
      metadata: {
        type: "meeting_joined",
        meetingId: meeting.id,
      },
    },
  });

  return {
    meeting: publicMeeting(meeting),
    participant: publicParticipant(participant),
    participants: participants.map(publicParticipant),
  };
}

export async function leaveMeeting(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId },
    include: {
      board: {
        include: {
          project: { select: { id: true, workspaceId: true } },
        },
      },
    },
  });
  if (!meeting || meeting.board.deletedAt || !meeting.board.project) {
    throw new AppError("Meeting not found", 404, "MEETING_NOT_FOUND");
  }

  await getAccessibleProject(userId, meeting.board.project.id);

  const existing = await prisma.meetingParticipant.findUnique({
    where: { meetingId_userId: { meetingId: meeting.id, userId } },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          avatarUrl: true,
        },
      },
    },
  });
  if (!existing) {
    throw new AppError("You are not a participant", 404, "PARTICIPANT_NOT_FOUND");
  }

  const wasHost = existing.isHost && existing.leftAt == null;
  const leftAt = existing.leftAt ?? new Date();

  if (!existing.leftAt) {
    await prisma.meetingParticipant.update({
      where: { id: existing.id },
      data: {
        leftAt,
        isHost: false,
      },
    });
  }

  await prisma.activity.create({
    data: {
      workspaceId: meeting.board.project.workspaceId,
      projectId: meeting.board.project.id,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: meeting.board.id,
      action: ActivityAction.UPDATE,
      metadata: {
        type: "meeting_left",
        meetingId: meeting.id,
      },
    },
  });

  const remaining = await prisma.meetingParticipant.findMany({
    where: {
      meetingId: meeting.id,
      leftAt: null,
    },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  let newHost: ReturnType<typeof publicParticipant> | null = null;
  if (wasHost && remaining.length > 0) {
    const nextHostRow = remaining[0]!;
    const promoted = await prisma.meetingParticipant.update({
      where: { id: nextHostRow.id },
      data: { isHost: true },
      include: participantInclude,
    });
    newHost = publicParticipant(promoted);
    remaining[0] = promoted;
  }

  let endedMeeting: ReturnType<typeof publicMeeting> | null = null;
  if (remaining.length === 0 && meeting.status === MeetingStatus.ACTIVE) {
    const now = new Date();
    const ended = await prisma.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MeetingStatus.ENDED,
        endedAt: now,
        endedBy: userId,
      },
    });
    endedMeeting = publicMeeting(ended);
  }

  return {
    meeting: publicMeeting(meeting),
    participant: publicParticipant({
      ...existing,
      isHost: false,
      leftAt,
    }),
    endedMeeting,
    newHost,
    participants: remaining.map(publicParticipant),
  };
}

export async function endMeeting(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId },
    include: {
      board: {
        include: {
          project: { select: { id: true, workspaceId: true } },
        },
      },
    },
  });
  if (!meeting || meeting.board.deletedAt || !meeting.board.project) {
    throw new AppError("Meeting not found", 404, "MEETING_NOT_FOUND");
  }
  if (meeting.status !== MeetingStatus.ACTIVE) {
    throw new AppError("Meeting already ended", 409, "MEETING_NOT_ACTIVE");
  }

  const access = await getAccessibleProject(userId, meeting.board.project.id);
  const actorParticipant = await prisma.meetingParticipant.findUnique({
    where: {
      meetingId_userId: {
        meetingId: meeting.id,
        userId,
      },
    },
  });
  const isActiveHost = Boolean(
    actorParticipant?.isHost && actorParticipant.leftAt == null,
  );
  if (!isActiveHost && !access.canManageProject) {
    throw new AppError("Only the meeting host can end this meeting", 403, "FORBIDDEN");
  }

  const now = new Date();
  const ended = await prisma.$transaction(async (tx) => {
    await tx.meetingParticipant.updateMany({
      where: {
        meetingId: meeting.id,
        leftAt: null,
      },
      data: {
        leftAt: now,
      },
    });

    return tx.meeting.update({
      where: { id: meeting.id },
      data: {
        status: MeetingStatus.ENDED,
        endedAt: now,
        endedBy: userId,
      },
    });
  });

  await prisma.activity.create({
    data: {
      workspaceId: meeting.board.project.workspaceId,
      projectId: meeting.board.project.id,
      actorId: userId,
      entityType: ActivityEntityType.BOARD,
      entityId: meeting.board.id,
      action: ActivityAction.UPDATE,
      metadata: {
        type: "meeting_ended",
        meetingId: meeting.id,
      },
      afterData: {
        meetingId: meeting.id,
        status: ended.status,
      },
    },
  });

  return publicMeeting(ended);
}

async function requireActiveMeeting(meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId },
    include: {
      board: {
        include: {
          project: { select: { id: true, workspaceId: true } },
        },
      },
    },
  });
  if (!meeting || meeting.board.deletedAt || !meeting.board.project) {
    throw new AppError("Meeting not found", 404, "MEETING_NOT_FOUND");
  }
  if (meeting.status !== MeetingStatus.ACTIVE) {
    throw new AppError("Meeting is no longer active", 409, "MEETING_NOT_ACTIVE");
  }
  return meeting;
}

async function requireActiveHost(meetingId: string, userId: string) {
  const host = await prisma.meetingParticipant.findFirst({
    where: {
      meetingId,
      userId,
      leftAt: null,
      isHost: true,
    },
  });
  if (!host) {
    throw new AppError("Only the meeting host can perform this action", 403, "FORBIDDEN");
  }
  return host;
}

export async function transferHost(
  userId: string,
  meetingId: string,
  toUserId: string,
) {
  const meeting = await requireActiveMeeting(meetingId);
  await getAccessibleProject(userId, meeting.board.project.id);
  await requireActiveHost(meeting.id, userId);

  if (toUserId === userId) {
    throw new AppError("Already the host", 409, "BAD_PAYLOAD");
  }

  const target = await prisma.meetingParticipant.findFirst({
    where: {
      meetingId: meeting.id,
      userId: toUserId,
      leftAt: null,
    },
    include: participantInclude,
  });
  if (!target) {
    throw new AppError("Target is not in the meeting", 404, "PARTICIPANT_NOT_FOUND");
  }

  await prisma.$transaction([
    prisma.meetingParticipant.updateMany({
      where: { meetingId: meeting.id, leftAt: null, isHost: true },
      data: { isHost: false },
    }),
    prisma.meetingParticipant.update({
      where: { id: target.id },
      data: { isHost: true },
    }),
  ]);

  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  const newHost = participants.find((p) => p.userId === toUserId)!;

  return {
    meeting: publicMeeting({ ...meeting, participants }),
    newHost: publicParticipant(newHost),
    participants: participants.map(publicParticipant),
  };
}

export async function kickParticipant(
  userId: string,
  meetingId: string,
  targetUserId: string,
) {
  const meeting = await requireActiveMeeting(meetingId);
  await getAccessibleProject(userId, meeting.board.project.id);
  await requireActiveHost(meeting.id, userId);

  if (targetUserId === userId) {
    throw new AppError("Use leave to exit the meeting", 409, "BAD_PAYLOAD");
  }

  const target = await prisma.meetingParticipant.findFirst({
    where: {
      meetingId: meeting.id,
      userId: targetUserId,
      leftAt: null,
    },
    include: participantInclude,
  });
  if (!target) {
    throw new AppError("Target is not in the meeting", 404, "PARTICIPANT_NOT_FOUND");
  }

  const leftAt = new Date();
  const kicked = await prisma.meetingParticipant.update({
    where: { id: target.id },
    data: { leftAt, isHost: false },
    include: participantInclude,
  });

  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  return {
    meeting: publicMeeting(meeting),
    participant: publicParticipant({ ...kicked, leftAt }),
    participants: participants.map(publicParticipant),
  };
}

export async function updateMyAppearance(
  userId: string,
  meetingId: string,
  input: UpdateMyAppearanceInput,
) {
  const meeting = await requireActiveMeeting(meetingId);
  await getAccessibleProject(userId, meeting.board.project.id);

  const existing = await prisma.meetingParticipant.findFirst({
    where: { meetingId: meeting.id, userId, leftAt: null },
  });
  if (!existing) {
    throw new AppError("You are not in this meeting", 404, "PARTICIPANT_NOT_FOUND");
  }

  let nextMode = input.tileBgMode ?? existing.tileBgMode;
  let nextUrl =
    input.tileBgUrl !== undefined ? input.tileBgUrl : existing.tileBgUrl;

  if (nextMode === MeetingTileBgMode.NONE || nextMode === MeetingTileBgMode.BLUR) {
    nextUrl = null;
  }
  if (nextMode === MeetingTileBgMode.IMAGE && !nextUrl) {
    throw new AppError(
      "Upload a background image before selecting IMAGE mode",
      400,
      "BAD_PAYLOAD",
    );
  }

  const displayName =
    input.displayName === undefined
      ? undefined
      : input.displayName === "" || input.displayName === null
        ? null
        : input.displayName.trim();

  const updated = await prisma.meetingParticipant.update({
    where: { id: existing.id },
    data: {
      ...(displayName !== undefined ? { displayName } : {}),
      ...(input.tileBgMode !== undefined || input.tileBgUrl !== undefined
        ? { tileBgMode: nextMode, tileBgUrl: nextUrl }
        : {}),
    },
    include: participantInclude,
  });

  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  return {
    meeting: publicMeeting({ ...meeting, participants }),
    participant: publicParticipant(updated),
    participants: participants.map(publicParticipant),
  };
}

export async function uploadMyTileBackground(
  userId: string,
  meetingId: string,
  file: Express.Multer.File,
) {
  const meeting = await requireActiveMeeting(meetingId);
  await getAccessibleProject(userId, meeting.board.project.id);

  const existing = await prisma.meetingParticipant.findFirst({
    where: { meetingId: meeting.id, userId, leftAt: null },
  });
  if (!existing) {
    throw new AppError("You are not in this meeting", 404, "PARTICIPANT_NOT_FOUND");
  }

  const mime = file.mimetype || "application/octet-stream";
  if (!mime.startsWith("image/")) {
    throw new AppError(
      "Background must be an image (JPEG, PNG, WebP, or GIF)",
      400,
      "UNSUPPORTED_FILE_TYPE",
    );
  }

  const uploaded = await uploadBuffer({
    buffer: file.buffer,
    originalName: file.originalname || "meeting-bg.jpg",
    mimeType: mime,
  });

  const updated = await prisma.meetingParticipant.update({
    where: { id: existing.id },
    data: {
      tileBgMode: MeetingTileBgMode.IMAGE,
      tileBgUrl: uploaded.fileUrl,
    },
    include: participantInclude,
  });

  const participants = await prisma.meetingParticipant.findMany({
    where: { meetingId: meeting.id, leftAt: null },
    include: participantInclude,
    orderBy: { joinedAt: "asc" },
  });

  return {
    meeting: publicMeeting({ ...meeting, participants }),
    participant: publicParticipant(updated),
    participants: participants.map(publicParticipant),
  };
}
