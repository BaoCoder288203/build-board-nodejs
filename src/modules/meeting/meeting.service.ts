import {
  ActivityAction,
  ActivityEntityType,
  NotificationEntityType,
  NotificationType,
  MeetingStatus,
} from "@prisma/client";
import { getAccessibleProject } from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { notifyMany } from "../../common/notify.js";
import { prisma } from "../../database/prisma.js";
import type { CreateMeetingInput } from "./meeting.schema.js";

const participantInclude = {
  user: {
    select: {
      id: true,
      fullName: true,
      avatarUrl: true,
    },
  },
} as const;

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

function publicParticipant(
  participant: {
    userId: string;
    isHost: boolean;
    joinedAt: Date;
    leftAt: Date | null;
    user: { id: string; fullName: string; avatarUrl: string | null };
  },
) {
  return {
    userId: participant.userId,
    fullName: participant.user.fullName,
    avatar: participant.user.avatarUrl,
    isHost: participant.isHost,
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
  };
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
    participants?: Array<{
      userId: string;
      isHost: boolean;
      joinedAt: Date;
      leftAt: Date | null;
      user: { id: string; fullName: string; avatarUrl: string | null };
    }>;
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
  if (!existing.leftAt) {
    await prisma.meetingParticipant.update({
      where: { id: existing.id },
      data: { leftAt: new Date() },
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

  const activeCount = await prisma.meetingParticipant.count({
    where: {
      meetingId: meeting.id,
      leftAt: null,
    },
  });

  let endedMeeting: ReturnType<typeof publicMeeting> | null = null;
  if (activeCount === 0 && meeting.status === MeetingStatus.ACTIVE) {
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
      leftAt: existing.leftAt ?? new Date(),
    }),
    endedMeeting,
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
  const isHost = Boolean(actorParticipant?.isHost);
  if (!isHost && !access.canManageProject) {
    throw new AppError("Only host can end this meeting", 403, "FORBIDDEN");
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
