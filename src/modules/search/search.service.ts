import type { Prisma } from "@prisma/client";
import { getWorkspaceMembership } from "../../common/access.js";
import { AppError } from "../../common/app-error.js";
import { prisma } from "../../database/prisma.js";
import type { GlobalSearchQuery, SearchTasksQuery } from "./search.schema.js";

async function resolveWorkspaceIds(
  userId: string,
  workspaceId?: string,
): Promise<string[]> {
  if (workspaceId) {
    await getWorkspaceMembership(userId, workspaceId);
    return [workspaceId];
  }

  const memberships = await prisma.workspaceMember.findMany({
    where: { userId, workspace: { deletedAt: null } },
    select: { workspaceId: true },
  });
  return memberships.map((m) => m.workspaceId);
}

function contains(keyword: string): Prisma.StringFilter {
  return { contains: keyword, mode: "insensitive" };
}

export async function globalSearch(userId: string, query: GlobalSearchQuery) {
  const workspaceIds = await resolveWorkspaceIds(userId, query.workspaceId);
  if (workspaceIds.length === 0) {
    return {
      projects: [],
      boards: [],
      tasks: [],
      comments: [],
      members: [],
    };
  }

  const kw = query.keyword;
  const limit = query.limit;
  const inWorkspaces = { in: workspaceIds };

  const [projects, boards, tasks, comments, members] = await Promise.all([
    prisma.project.findMany({
      where: {
        workspaceId: inWorkspaces,
        deletedAt: null,
        OR: [{ name: contains(kw) }, { slug: contains(kw) }],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        workspaceId: true,
        color: true,
        updatedAt: true,
        workspace: { select: { id: true, name: true } },
      },
    }),
    prisma.board.findMany({
      where: {
        deletedAt: null,
        project: { workspaceId: inWorkspaces, deletedAt: null },
        OR: [{ name: contains(kw) }, { description: contains(kw) }],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        projectId: true,
        updatedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            workspaceId: true,
            workspace: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: {
        workspaceId: inWorkspaces,
        deletedAt: null,
        OR: [{ title: contains(kw) }, { code: contains(kw) }],
      },
      take: limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        boardId: true,
        projectId: true,
        workspaceId: true,
        updatedAt: true,
        project: { select: { name: true } },
        board: { select: { name: true } },
        workspace: { select: { name: true } },
      },
    }),
    prisma.comment.findMany({
      where: {
        deletedAt: null,
        content: contains(kw),
        task: { workspaceId: inWorkspaces, deletedAt: null },
      },
      take: limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        content: true,
        taskId: true,
        createdAt: true,
        task: {
          select: {
            id: true,
            title: true,
            code: true,
            boardId: true,
            projectId: true,
            workspaceId: true,
          },
        },
        author: {
          select: {
            user: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    }),
    prisma.workspaceMember.findMany({
      where: {
        workspaceId: inWorkspaces,
        user: {
          OR: [
            { fullName: contains(kw) },
            { email: contains(kw) },
            { username: contains(kw) },
          ],
        },
      },
      take: limit,
      orderBy: { joinedAt: "desc" },
      select: {
        id: true,
        workspaceId: true,
        joinedAt: true,
        workspace: { select: { id: true, name: true } },
        role: { select: { name: true } },
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
    }),
  ]);

  return {
    projects: projects.map((p) => ({
      id: p.id,
      type: "project" as const,
      name: p.name,
      slug: p.slug,
      workspaceId: p.workspaceId,
      workspaceName: p.workspace.name,
      color: p.color,
      updatedAt: p.updatedAt,
    })),
    boards: boards.map((b) => ({
      id: b.id,
      type: "board" as const,
      name: b.name,
      projectId: b.projectId,
      projectName: b.project.name,
      workspaceId: b.project.workspaceId,
      workspaceName: b.project.workspace.name,
      updatedAt: b.updatedAt,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      type: "task" as const,
      code: t.code,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      boardId: t.boardId,
      boardName: t.board.name,
      projectId: t.projectId,
      projectName: t.project.name,
      workspaceId: t.workspaceId,
      workspaceName: t.workspace.name,
      updatedAt: t.updatedAt,
    })),
    comments: comments.map((c) => ({
      id: c.id,
      type: "comment" as const,
      content: c.content.slice(0, 160),
      taskId: c.taskId,
      taskTitle: c.task.title,
      taskCode: c.task.code,
      boardId: c.task.boardId,
      projectId: c.task.projectId,
      workspaceId: c.task.workspaceId,
      createdAt: c.createdAt,
      author: {
        id: c.author.user.id,
        fullName: c.author.user.fullName,
        avatar: c.author.user.avatarUrl,
      },
    })),
    members: members.map((m) => ({
      id: m.id,
      type: "member" as const,
      workspaceMemberId: m.id,
      workspaceId: m.workspaceId,
      workspaceName: m.workspace.name,
      roleName: m.role.name,
      joinedAt: m.joinedAt,
      user: {
        id: m.user.id,
        fullName: m.user.fullName,
        email: m.user.email,
        username: m.user.username,
        avatar: m.user.avatarUrl,
      },
    })),
  };
}

export async function searchTasks(userId: string, query: SearchTasksQuery) {
  await getWorkspaceMembership(userId, query.workspaceId);

  if (query.projectId) {
    const project = await prisma.project.findFirst({
      where: {
        id: query.projectId,
        workspaceId: query.workspaceId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!project) {
      throw new AppError("Project not found", 404, "PROJECT_NOT_FOUND");
    }
  }

  if (query.boardId) {
    const board = await prisma.board.findFirst({
      where: {
        id: query.boardId,
        deletedAt: null,
        project: { workspaceId: query.workspaceId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!board) {
      throw new AppError("Board not found", 404, "BOARD_NOT_FOUND");
    }
  }

  const where: Prisma.TaskWhereInput = {
    workspaceId: query.workspaceId,
    deletedAt: null,
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(query.boardId ? { boardId: query.boardId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.keyword
      ? {
          OR: [
            { title: contains(query.keyword) },
            { code: contains(query.keyword) },
            { description: contains(query.keyword) },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.TaskOrderByWithRelationInput = {
    [query.sortBy]: query.sortOrder,
  };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        priority: true,
        dueDate: true,
        boardId: true,
        projectId: true,
        workspaceId: true,
        updatedAt: true,
        createdAt: true,
        project: { select: { name: true } },
        board: { select: { name: true } },
      },
    }),
  ]);

  return {
    items: rows.map((t) => ({
      id: t.id,
      type: "task" as const,
      code: t.code,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueDate: t.dueDate,
      boardId: t.boardId,
      boardName: t.board.name,
      projectId: t.projectId,
      projectName: t.project.name,
      workspaceId: t.workspaceId,
      updatedAt: t.updatedAt,
      createdAt: t.createdAt,
    })),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}
