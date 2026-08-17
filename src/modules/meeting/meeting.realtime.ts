import { SERVER_EVENT } from "../../realtime/events.js";

type RealtimeEmitter = {
  to: (room: string) => { emit: (event: string, payload: unknown) => void };
} | null;

function emitToBoardAndWorkspace(
  rt: Exclude<RealtimeEmitter, null>,
  boardId: string,
  workspaceId: string,
  event: string,
  payload: unknown,
) {
  rt.to(`board:${boardId}`).emit(event, payload);
  rt.to(`workspace:${workspaceId}`).emit(event, payload);
}

export function emitMeetingParticipantEvent(
  rt: RealtimeEmitter,
  event: typeof SERVER_EVENT.MEETING_JOINED | typeof SERVER_EVENT.MEETING_LEFT,
  input: {
    meetingId: string;
    boardId: string;
    workspaceId: string;
    participant: unknown;
    actorId: string;
  },
) {
  if (!rt) return;
  emitToBoardAndWorkspace(rt, input.boardId, input.workspaceId, event, {
    meetingId: input.meetingId,
    boardId: input.boardId,
    workspaceId: input.workspaceId,
    participant: input.participant,
    actorId: input.actorId,
    occurredAt: new Date().toISOString(),
  });
}

export function emitMeetingLeft(
  rt: RealtimeEmitter,
  input: {
    meetingId: string;
    boardId: string;
    workspaceId: string;
    participant: unknown;
    actorId: string;
  },
) {
  emitMeetingParticipantEvent(rt, SERVER_EVENT.MEETING_LEFT, input);
}

export function emitMeetingParticipants(
  rt: RealtimeEmitter,
  input: {
    meetingId: string;
    boardId: string;
    workspaceId: string;
    participants: unknown[];
  },
) {
  if (!rt) return;
  emitToBoardAndWorkspace(
    rt,
    input.boardId,
    input.workspaceId,
    SERVER_EVENT.MEETING_PARTICIPANTS,
    {
      meetingId: input.meetingId,
      boardId: input.boardId,
      workspaceId: input.workspaceId,
      participants: input.participants,
      occurredAt: new Date().toISOString(),
    },
  );
}

export function emitMeetingEnded(
  rt: RealtimeEmitter,
  input: {
    meetingId: string;
    boardId: string;
    workspaceId: string;
    endedBy: string;
  },
) {
  if (!rt) return;
  emitToBoardAndWorkspace(rt, input.boardId, input.workspaceId, SERVER_EVENT.MEETING_ENDED, {
    meetingId: input.meetingId,
    boardId: input.boardId,
    workspaceId: input.workspaceId,
    endedBy: input.endedBy,
    occurredAt: new Date().toISOString(),
  });
}

export function broadcastMeetingLeave(
  rt: RealtimeEmitter,
  result: {
    meeting: { id: string; boardId: string; workspaceId: string };
    participant: unknown;
    participants: unknown[];
    endedMeeting: { id: string; boardId: string; workspaceId: string } | null;
  },
  actorId: string,
  onEnded?: (meetingId: string) => void,
) {
  emitMeetingLeft(rt, {
    meetingId: result.meeting.id,
    boardId: result.meeting.boardId,
    workspaceId: result.meeting.workspaceId,
    participant: result.participant,
    actorId,
  });
  if (result.endedMeeting) {
    onEnded?.(result.endedMeeting.id);
    emitMeetingEnded(rt, {
      meetingId: result.endedMeeting.id,
      boardId: result.endedMeeting.boardId,
      workspaceId: result.endedMeeting.workspaceId,
      endedBy: actorId,
    });
    emitMeetingParticipants(rt, {
      meetingId: result.endedMeeting.id,
      boardId: result.endedMeeting.boardId,
      workspaceId: result.endedMeeting.workspaceId,
      participants: [],
    });
    return;
  }
  emitMeetingParticipants(rt, {
    meetingId: result.meeting.id,
    boardId: result.meeting.boardId,
    workspaceId: result.meeting.workspaceId,
    participants: result.participants,
  });
}
