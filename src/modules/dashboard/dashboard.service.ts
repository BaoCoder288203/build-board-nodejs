import { TaskStatus, type Prisma } from "@prisma/client";
import { getWorkspaceMembership } from "../../common/access.js";
import { prisma } from "../../database/prisma.js";
import type { MyTasksQuery, UpcomingQuery } from "./dashboard.schema.js";

const taskListSelect = {
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
  project: { select: { id: true, name: true, slug: true } },
  board: { select: { id: true, name: true } },
} as const;

function publicDashboardTask(
  task: {
    id: string;
    code: string;
    title: string;
    status: TaskStatus;
    priority: string;
    dueDate: Date | null;
    boardId: string;
    projectId: string;
    workspaceId: string;
    updatedAt: Date;
    project: { id: string; name: string; slug: string };
    board: { id: string; name: string };
  },
  now = new Date(),
) {
  return {
    id: task.id,
    taskId: task.id,
    code: task.code,
    title: task.title,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    boardId: task.boardId,
    projectId: task.projectId,
    workspaceId: task.workspaceId,
    updatedAt: task.updatedAt,
    projectName: task.project.name,
    projectSlug: task.project.slug,
    boardName: task.board.name,
    isOverdue: Boolean(
      task.dueDate &&
        task.dueDate < now &&
        task.status !== TaskStatus.DONE,
    ),
  };
}

export async function getSummary(userId: string, workspaceId: string) {
  const { workspace, member } = await getWorkspaceMembership(
    userId,
    workspaceId,
  );

  const now = new Date();
  const soon = new Date(now);
  soon.setDate(soon.getDate() + 7);

  const baseTaskWhere: Prisma.TaskWhereInput = {
    workspaceId,
    deletedAt: null,
  };

  const [
    membersCount,
    projectsCount,
    boardsCount,
    taskGroups,
    overdueCount,
    dueSoonCount,
    projects,
  ] = await Promise.all([
    prisma.workspaceMember.count({ where: { workspaceId } }),
    prisma.project.count({ where: { workspaceId, deletedAt: null } }),
    prisma.board.count({
      where: { project: { workspaceId, deletedAt: null }, deletedAt: null },
    }),
    prisma.task.groupBy({
      by: ["status"],
      where: baseTaskWhere,
      _count: { _all: true },
    }),
    prisma.task.count({
      where: {
        ...baseTaskWhere,
        dueDate: { lt: now },
        status: { not: TaskStatus.DONE },
      },
    }),
    prisma.task.count({
      where: {
        ...baseTaskWhere,
        dueDate: { gte: now, lte: soon },
        status: { not: TaskStatus.DONE },
      },
    }),
    prisma.project.findMany({
      where: { workspaceId, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        id: true,
        name: true,
        slug: true,
        updatedAt: true,
        _count: {
          select: {
            boards: { where: { deletedAt: null } },
            tasks: { where: { deletedAt: null } },
          },
        },
      },
    }),
  ]);

  const byStatus: Record<TaskStatus, number> = {
    TODO: 0,
    IN_PROGRESS: 0,
    REVIEW: 0,
    DONE: 0,
  };
  let tasksTotal = 0;
  for (const row of taskGroups) {
    byStatus[row.status] = row._count._all;
    tasksTotal += row._count._all;
  }

  const projectIds = projects.map((p) => p.id);
  const doneByProject =
    projectIds.length === 0
      ? []
      : await prisma.task.groupBy({
          by: ["projectId"],
          where: {
            projectId: { in: projectIds },
            deletedAt: null,
            status: TaskStatus.DONE,
          },
          _count: { _all: true },
        });
  const doneMap = new Map(
    doneByProject.map((r) => [r.projectId, r._count._all]),
  );

  return {
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      membersCount,
      projectsCount,
      boardsCount,
      myMemberId: member.id,
    },
    tasks: {
      total: tasksTotal,
      todo: byStatus.TODO,
      inProgress: byStatus.IN_PROGRESS,
      review: byStatus.REVIEW,
      done: byStatus.DONE,
      overdue: overdueCount,
      dueSoon: dueSoonCount,
    },
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      updatedAt: p.updatedAt,
      boardsCount: p._count.boards,
      tasksTotal: p._count.tasks,
      tasksDone: doneMap.get(p.id) ?? 0,
    })),
  };
}

export async function listMyTasks(userId: string, query: MyTasksQuery) {
  const { member } = await getWorkspaceMembership(userId, query.workspaceId);

  const where: Prisma.TaskWhereInput = {
    workspaceId: query.workspaceId,
    deletedAt: null,
    assignments: { some: { workspaceMemberId: member.id } },
    ...(query.status ? { status: query.status } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      select: taskListSelect,
      orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  const now = new Date();
  return {
    items: rows.map((t) => publicDashboardTask(t, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function listUpcoming(userId: string, query: UpcomingQuery) {
  await getWorkspaceMembership(userId, query.workspaceId);

  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() + query.days);

  const where: Prisma.TaskWhereInput = {
    workspaceId: query.workspaceId,
    deletedAt: null,
    status: { not: TaskStatus.DONE },
    dueDate: { not: null, lte: until },
  };

  const [total, rows] = await Promise.all([
    prisma.task.count({ where }),
    prisma.task.findMany({
      where,
      select: taskListSelect,
      orderBy: [{ dueDate: "asc" }, { priority: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  return {
    items: rows.map((t) => publicDashboardTask(t, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
    days: query.days,
  };
}
