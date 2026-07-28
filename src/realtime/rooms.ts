import { prisma } from "../database/prisma.js";
import { AppError } from "../common/app-error.js";
import { roomKindSchema, type RoomKey } from "./events.js";

function parseRoom(room: RoomKey) {
  const [kind, entityId] = room.split(":");
  const parsedKind = roomKindSchema.safeParse(kind);
  if (!parsedKind.success || !entityId) {
    throw new AppError("Invalid room", 400, "BAD_PAYLOAD");
  }
  return { kind: parsedKind.data, entityId };
}

async function assertWorkspaceAccess(userId: string, workspaceId: string) {
  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
  });
  if (!member) {
    throw new AppError("Forbidden room", 403, "FORBIDDEN");
  }
}

async function assertBoardAccess(userId: string, boardId: string) {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    select: { project: { select: { workspaceId: true } } },
  });
  if (!board) {
    throw new AppError("Room target not found", 404, "ROOM_NOT_FOUND");
  }
  await assertWorkspaceAccess(userId, board.project.workspaceId);
}

async function assertTaskAccess(userId: string, taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { workspaceId: true },
  });
  if (!task) {
    throw new AppError("Room target not found", 404, "ROOM_NOT_FOUND");
  }
  await assertWorkspaceAccess(userId, task.workspaceId);
}

async function assertMeetingAccess(userId: string, meetingId: string) {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, status: "ACTIVE" },
    select: { workspaceId: true },
  });
  if (!meeting) {
    throw new AppError("Room target not found", 404, "ROOM_NOT_FOUND");
  }
  await assertWorkspaceAccess(userId, meeting.workspaceId);
}

export async function assertRoomAccess(userId: string, room: RoomKey) {
  const { kind, entityId } = parseRoom(room);
  if (kind === "workspace") {
    await assertWorkspaceAccess(userId, entityId);
    return;
  }
  if (kind === "board") {
    await assertBoardAccess(userId, entityId);
    return;
  }
  if (kind === "task") {
    await assertTaskAccess(userId, entityId);
    return;
  }
  await assertMeetingAccess(userId, entityId);
}
