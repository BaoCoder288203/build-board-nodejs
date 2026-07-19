import {
  ActivityAction,
  ActivityEntityType,
  type Prisma,
} from "@prisma/client";
import {
  assertPermission,
  getAccessibleProject,
  getWorkspaceMembership,
} from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type {
  CreateCommentInput,
  ReplyCommentInput,
  UpdateCommentInput,
} from "./comment.schema.js";

const authorInclude = {
  author: {
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          username: true,
          avatarUrl: true,
        },
      },
      role: { select: { id: true, name: true } },
    },
  },
  mentions: {
    include: {
      workspaceMember: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              username: true,
              avatarUrl: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CommentInclude;

type CommentRow = Prisma.CommentGetPayload<{ include: typeof authorInclude }>;

function publicComment(comment: CommentRow, replyCount = 0) {
  return {
    id: comment.id,
    commentId: comment.id,
    taskId: comment.taskId,
    parentCommentId: comment.parentCommentId,
    content: comment.content,
    isEdited: comment.isEdited,
    editedAt: comment.editedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    replyCount,
    author: {
      workspaceMemberId: comment.workspaceMemberId,
      role: comment.author.role,
      user: {
        id: comment.author.user.id,
        fullName: comment.author.user.fullName,
        email: comment.author.user.email,
        username: comment.author.user.username,
        avatar: comment.author.user.avatarUrl,
      },
    },
    mentions: comment.mentions.map((m) => ({
      workspaceMemberId: m.workspaceMemberId,
      user: {
        id: m.workspaceMember.user.id,
        fullName: m.workspaceMember.user.fullName,
        email: m.workspaceMember.user.email,
        username: m.workspaceMember.user.username,
        avatar: m.workspaceMember.user.avatarUrl,
      },
    })),
  };
}

async function getTaskOrThrow(taskId: string) {
  const task = await prisma.task.findFirst({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) throw new AppError("Task not found", 404, "TASK_NOT_FOUND");
  return task;
}

async function assertTaskAccess(
  userId: string,
  projectId: string,
  permission?: string,
) {
  const access = await getAccessibleProject(userId, projectId);
  if (permission) {
    assertPermission(access.workspaceCtx, permission);
  }
  return access;
}

async function resolveMentionMemberIds(
  workspaceId: string,
  mentionUserIds: string[] | undefined,
) {
  if (!mentionUserIds?.length) return [] as string[];
  const unique = [...new Set(mentionUserIds)];
  const members = await prisma.workspaceMember.findMany({
    where: {
      workspaceId,
      userId: { in: unique },
    },
    select: { id: true, userId: true },
  });
  if (members.length !== unique.length) {
    throw new AppError(
      "One or more mentioned users are not workspace members",
      400,
      "VALIDATION_ERROR",
    );
  }
  return members.map((m) => m.id);
}

async function getCommentOrThrow(commentId: string) {
  const comment = await prisma.comment.findFirst({
    where: { id: commentId, deletedAt: null },
    include: {
      ...authorInclude,
      task: true,
    },
  });
  if (!comment || comment.task.deletedAt) {
    throw new AppError("Comment not found", 404, "COMMENT_NOT_FOUND");
  }
  return comment;
}

function assertCanMutateComment(
  access: Awaited<ReturnType<typeof assertTaskAccess>>,
  comment: { workspaceMemberId: string },
  actorMemberId: string,
) {
  const isAuthor = comment.workspaceMemberId === actorMemberId;
  const canManage =
    access.workspaceCtx.isOwner ||
    access.workspaceCtx.permissions.includes("task:update") ||
    access.canManageProject;
  if (!isAuthor && !canManage) {
    throw new AppError(
      "You can only edit or delete your own comments",
      403,
      "FORBIDDEN",
    );
  }
}

async function createCommentRecord(options: {
  userId: string;
  task: { id: string; workspaceId: string; projectId: string };
  content: string;
  parentCommentId?: string | null;
  mentionUserIds?: string[];
}) {
  const { userId, task, content, parentCommentId, mentionUserIds } = options;
  await assertTaskAccess(userId, task.projectId, "task:update");
  const membership = await getWorkspaceMembership(userId, task.workspaceId);
  const mentionMemberIds = await resolveMentionMemberIds(
    task.workspaceId,
    mentionUserIds,
  );

  const created = await prisma.$transaction(async (tx) => {
    const comment = await tx.comment.create({
      data: {
        taskId: task.id,
        parentCommentId: parentCommentId ?? null,
        workspaceMemberId: membership.member.id,
        content,
        mentions: mentionMemberIds.length
          ? {
              create: mentionMemberIds.map((workspaceMemberId) => ({
                workspaceMemberId,
              })),
            }
          : undefined,
      },
      include: authorInclude,
    });

    await tx.activity.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COMMENT,
        entityId: comment.id,
        action: ActivityAction.COMMENT,
        afterData: {
          taskId: task.id,
          parentCommentId: parentCommentId ?? null,
          contentPreview: content.slice(0, 120),
        },
      },
    });

    return comment;
  });

  return publicComment(created, 0);
}

export async function createComment(userId: string, input: CreateCommentInput) {
  const task = await getTaskOrThrow(input.taskId);
  return createCommentRecord({
    userId,
    task,
    content: input.content,
    mentionUserIds: input.mentions,
  });
}

export async function listComments(
  userId: string,
  query: { taskId: string; page: number; limit: number },
) {
  const task = await getTaskOrThrow(query.taskId);
  await assertTaskAccess(userId, task.projectId);

  const where: Prisma.CommentWhereInput = {
    taskId: query.taskId,
    parentCommentId: null,
    deletedAt: null,
  };

  const skip = (query.page - 1) * query.limit;
  const [total, rows] = await Promise.all([
    prisma.comment.count({ where }),
    prisma.comment.findMany({
      where,
      skip,
      take: query.limit,
      orderBy: { createdAt: "asc" },
      include: {
        ...authorInclude,
        _count: {
          select: {
            replies: { where: { deletedAt: null } },
          },
        },
      },
    }),
  ]);

  return {
    items: rows.map((c) => publicComment(c, c._count.replies)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

export async function updateComment(
  userId: string,
  commentId: string,
  input: UpdateCommentInput,
) {
  const comment = await getCommentOrThrow(commentId);
  const access = await assertTaskAccess(
    userId,
    comment.task.projectId,
    "task:update",
  );
  const membership = await getWorkspaceMembership(
    userId,
    comment.task.workspaceId,
  );
  assertCanMutateComment(access, comment, membership.member.id);

  const mentionMemberIds =
    input.mentions !== undefined
      ? await resolveMentionMemberIds(
          comment.task.workspaceId,
          input.mentions,
        )
      : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (mentionMemberIds) {
      await tx.commentMention.deleteMany({ where: { commentId } });
      if (mentionMemberIds.length) {
        await tx.commentMention.createMany({
          data: mentionMemberIds.map((workspaceMemberId) => ({
            commentId,
            workspaceMemberId,
          })),
        });
      }
    }

    const row = await tx.comment.update({
      where: { id: commentId },
      data: {
        content: input.content,
        isEdited: true,
        editedAt: new Date(),
      },
      include: authorInclude,
    });

    await tx.activity.create({
      data: {
        workspaceId: comment.task.workspaceId,
        projectId: comment.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COMMENT,
        entityId: commentId,
        action: ActivityAction.UPDATE,
        beforeData: { contentPreview: comment.content.slice(0, 120) },
        afterData: { contentPreview: input.content.slice(0, 120) },
      },
    });

    return row;
  });

  const replyCount = await prisma.comment.count({
    where: { parentCommentId: commentId, deletedAt: null },
  });

  return publicComment(updated, replyCount);
}

export async function deleteComment(userId: string, commentId: string) {
  const comment = await getCommentOrThrow(commentId);
  const access = await assertTaskAccess(
    userId,
    comment.task.projectId,
    "task:update",
  );
  const membership = await getWorkspaceMembership(
    userId,
    comment.task.workspaceId,
  );
  assertCanMutateComment(access, comment, membership.member.id);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.comment.updateMany({
      where: {
        OR: [{ id: commentId }, { parentCommentId: commentId }],
        deletedAt: null,
      },
      data: { deletedAt: now },
    });
    await tx.activity.create({
      data: {
        workspaceId: comment.task.workspaceId,
        projectId: comment.task.projectId,
        actorId: userId,
        entityType: ActivityEntityType.COMMENT,
        entityId: commentId,
        action: ActivityAction.DELETE,
        beforeData: { contentPreview: comment.content.slice(0, 120) },
      },
    });
  });

  return { message: "Comment deleted" };
}

export async function replyToComment(
  userId: string,
  parentCommentId: string,
  input: ReplyCommentInput,
) {
  const parent = await getCommentOrThrow(parentCommentId);
  if (parent.parentCommentId) {
    throw new AppError(
      "Cannot reply to a reply. Reply to the parent comment instead.",
      400,
      "VALIDATION_ERROR",
    );
  }

  return createCommentRecord({
    userId,
    task: parent.task,
    content: input.content,
    parentCommentId: parent.id,
    mentionUserIds: input.mentions,
  });
}

export async function listReplies(userId: string, parentCommentId: string) {
  const parent = await getCommentOrThrow(parentCommentId);
  await assertTaskAccess(userId, parent.task.projectId);

  const rows = await prisma.comment.findMany({
    where: {
      parentCommentId,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    include: authorInclude,
  });

  return { items: rows.map((c) => publicComment(c, 0)) };
}
