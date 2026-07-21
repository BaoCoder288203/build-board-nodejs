import {
  ActivityAction,
  ActivityEntityType,
  InvitationStatus,
  NotificationEntityType,
  NotificationType,
} from "@prisma/client";
import { AppError } from "../../common/app-error.js";
import { notifyUser } from "../../common/notify.js";
import {
  pickWorkspaceTheme,
  resolveWorkspaceTheme,
} from "../../common/visual-identity.js";
import { env } from "../../config/env.js";
import { prisma } from "../../database/prisma.js";
import { sendEmail } from "../../providers/email.provider.js";
import { generateOpaqueToken, hashToken } from "../../utils/token.js";
import { SYSTEM_ROLES } from "./workspace.roles.js";
import type {
  CreateWorkspaceInput,
  InviteMemberInput,
  UpdateSettingsInput,
  UpdateWorkspaceInput,
} from "./workspace.schema.js";

function publicWorkspace(
  workspace: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    themeColorFrom?: string | null;
    themeColorTo?: string | null;
    visibility: string;
    timezone: string | null;
    ownerId: string;
    createdAt: Date;
    updatedAt: Date;
  },
  extras?: Record<string, unknown>,
) {
  const theme = resolveWorkspaceTheme(workspace);
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    logoUrl: workspace.logoUrl,
    coverUrl: workspace.coverUrl,
    themeColorFrom: theme.themeColorFrom,
    themeColorTo: theme.themeColorTo,
    visibility: workspace.visibility,
    timezone: workspace.timezone,
    ownerId: workspace.ownerId,
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
    ...extras,
  };
}

async function logActivity(input: {
  workspaceId: string;
  actorId: string;
  entityId: string;
  action: ActivityAction;
  afterData?: unknown;
  metadata?: unknown;
}) {
  await prisma.activity.create({
    data: {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      entityType: ActivityEntityType.WORKSPACE,
      entityId: input.entityId,
      action: input.action,
      afterData: input.afterData as object | undefined,
      metadata: input.metadata as object | undefined,
    },
  });
}

export async function createWorkspace(userId: string, input: CreateWorkspaceInput) {
  const slug = input.slug.toLowerCase();
  const existing = await prisma.workspace.findUnique({ where: { slug } });
  if (existing && !existing.deletedAt) {
    throw new AppError(
      "A workspace with this slug already exists",
      409,
      "WORKSPACE_SLUG_EXISTS",
    );
  }

  const workspace = await prisma.$transaction(async (tx) => {
    const theme = pickWorkspaceTheme(slug);
    const created = await tx.workspace.create({
      data: {
        name: input.name,
        slug,
        description: input.description ?? null,
        themeColorFrom: theme.themeColorFrom,
        themeColorTo: theme.themeColorTo,
        ownerId: userId,
        settings: {
          create: {
            defaultLanguage: "en",
            defaultTimezone: "UTC",
          },
        },
        storage: { create: {} },
      },
    });

    const roleMap = new Map<string, string>();
    for (const roleDef of SYSTEM_ROLES) {
      const role = await tx.workspaceRole.create({
        data: {
          workspaceId: created.id,
          name: roleDef.name,
          description: roleDef.description,
          isSystem: true,
          permissions: {
            create: roleDef.permissions.map((permissionKey) => ({
              permissionKey,
            })),
          },
        },
      });
      roleMap.set(roleDef.name, role.id);
    }

    const ownerRoleId = roleMap.get("Owner");
    if (!ownerRoleId) {
      throw new AppError("Failed to create owner role", 500, "INTERNAL_ERROR");
    }

    await tx.workspaceMember.create({
      data: {
        workspaceId: created.id,
        userId,
        roleId: ownerRoleId,
      },
    });

    await tx.activity.create({
      data: {
        workspaceId: created.id,
        actorId: userId,
        entityType: ActivityEntityType.WORKSPACE,
        entityId: created.id,
        action: ActivityAction.CREATE,
        afterData: { name: created.name, slug: created.slug },
      },
    });

    return created;
  });

  return publicWorkspace(workspace, { workspaceId: workspace.id });
}

export async function listMyWorkspaces(
  userId: string,
  page = 1,
  limit = 20,
) {
  const skip = (page - 1) * limit;
  const where = {
    deletedAt: null,
    members: { some: { userId } },
  };

  const [total, rows] = await Promise.all([
    prisma.workspace.count({ where }),
    prisma.workspace.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true, projects: true } },
        members: {
          where: { userId },
          include: { role: true },
          take: 1,
        },
      },
    }),
  ]);

  return {
    items: rows.map((ws) =>
      publicWorkspace(ws, {
        membersCount: ws._count.members,
        projectsCount: ws._count.projects,
        myRole: ws.members[0]?.role.name ?? null,
      }),
    ),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getWorkspace(workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    include: {
      owner: {
        select: {
          id: true,
          fullName: true,
          email: true,
          username: true,
          avatarUrl: true,
        },
      },
      _count: { select: { members: true, projects: true } },
    },
  });

  if (!workspace) {
    throw new AppError("Workspace not found", 404, "WORKSPACE_NOT_FOUND");
  }

  return publicWorkspace(workspace, {
    owner: {
      id: workspace.owner.id,
      fullName: workspace.owner.fullName,
      email: workspace.owner.email,
      username: workspace.owner.username,
      avatar: workspace.owner.avatarUrl,
    },
    membersCount: workspace._count.members,
    projectsCount: workspace._count.projects,
  });
}

export async function updateWorkspace(
  workspaceId: string,
  actorId: string,
  input: UpdateWorkspaceInput,
) {
  const workspace = await prisma.workspace.update({
    where: { id: workspaceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined
        ? { description: input.description }
        : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
    },
  });

  await logActivity({
    workspaceId,
    actorId,
    entityId: workspaceId,
    action: ActivityAction.UPDATE,
    afterData: input,
  });

  return publicWorkspace(workspace);
}

export async function deleteWorkspace(workspaceId: string, actorId: string) {
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { deletedAt: now },
    });
    await tx.project.updateMany({
      where: { workspaceId, deletedAt: null },
      data: { deletedAt: now },
    });
    await tx.activity.create({
      data: {
        workspaceId,
        actorId,
        entityType: ActivityEntityType.WORKSPACE,
        entityId: workspaceId,
        action: ActivityAction.DELETE,
      },
    });
  });

  return { message: "Workspace deleted successfully" };
}

export async function listRoles(workspaceId: string) {
  const roles = await prisma.workspaceRole.findMany({
    where: { workspaceId },
    include: { permissions: true, _count: { select: { members: true } } },
    orderBy: { createdAt: "asc" },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    isSystem: role.isSystem,
    membersCount: role._count.members,
    permissions: role.permissions.map((p) => p.permissionKey),
  }));
}

export async function listMembers(
  workspaceId: string,
  page = 1,
  limit = 20,
  search?: string,
) {
  const skip = (page - 1) * limit;
  const where = {
    workspaceId,
    ...(search
      ? {
          user: {
            OR: [
              { fullName: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { username: { contains: search, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.workspaceMember.count({ where }),
    prisma.workspaceMember.findMany({
      where,
      skip,
      take: limit,
      orderBy: { joinedAt: "asc" },
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
    }),
  ]);

  return {
    items: rows.map((m) => ({
      id: m.id,
      joinedAt: m.joinedAt,
      role: m.role,
      user: {
        id: m.user.id,
        fullName: m.user.fullName,
        email: m.user.email,
        username: m.user.username,
        avatar: m.user.avatarUrl,
      },
    })),
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function inviteMember(
  workspaceId: string,
  actorId: string,
  input: InviteMemberInput,
) {
  const email = input.email.toLowerCase();
  const role = await prisma.workspaceRole.findFirst({
    where: { id: input.roleId, workspaceId },
  });
  if (!role) {
    throw new AppError("Role not found in this workspace", 404, "ROLE_NOT_FOUND");
  }
  if (role.name === "Owner") {
    throw new AppError(
      "Cannot invite someone as Owner. Transfer ownership instead.",
      400,
      "INVALID_ROLE",
    );
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const existingMember = await prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId, userId: existingUser.id },
      },
    });
    if (existingMember) {
      throw new AppError(
        "This user is already a workspace member",
        409,
        "MEMBER_ALREADY_EXISTS",
      );
    }
  }

  const pending = await prisma.workspaceInvitation.findFirst({
    where: {
      workspaceId,
      email,
      status: InvitationStatus.PENDING,
      expiresAt: { gt: new Date() },
    },
  });
  if (pending) {
    throw new AppError(
      "An invitation is already pending for this email",
      409,
      "INVITATION_PENDING",
    );
  }

  const rawToken = generateOpaqueToken(32);
  const invitation = await prisma.workspaceInvitation.create({
    data: {
      workspaceId,
      email,
      roleId: role.id,
      token: hashToken(rawToken),
      invitedBy: actorId,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: InvitationStatus.PENDING,
    },
  });

  const feBase = env.CORS_ORIGIN.split(",")[0]?.trim() || "http://localhost:3000";
  const link = `${feBase}/workspaces/invitations?token=${rawToken}`;

  await sendEmail({
    to: email,
    subject: `You're invited to a BuildBoard workspace`,
    html: `<p>You have been invited to join a workspace.</p><p><a href="${link}">Accept invitation</a></p>`,
  });

  if (existingUser) {
    await notifyUser({
      workspaceId,
      recipientId: existingUser.id,
      senderId: actorId,
      entityType: NotificationEntityType.WORKSPACE,
      entityId: invitation.id,
      notificationType: NotificationType.WORKSPACE_INVITE,
      title: "Workspace invitation",
      message: `You were invited to join a workspace as ${role.name}.`,
    });
  }

  await logActivity({
    workspaceId,
    actorId,
    entityId: invitation.id,
    action: ActivityAction.CREATE,
    metadata: { type: "invitation", email, role: role.name },
  });

  return {
    message: "Invitation sent",
    invitationId: invitation.id,
    ...(env.NODE_ENV === "development" ? { debugToken: rawToken, acceptUrl: link } : {}),
  };
}

export async function acceptInvitation(userId: string, userEmail: string, rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token: tokenHash },
    include: { role: true, workspace: true },
  });

  if (!invitation || invitation.status !== InvitationStatus.PENDING) {
    throw new AppError("Invalid or expired invitation", 400, "INVITATION_EXPIRED");
  }
  if (invitation.expiresAt < new Date()) {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: { status: InvitationStatus.EXPIRED },
    });
    throw new AppError("This invitation has expired", 400, "INVITATION_EXPIRED");
  }
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new AppError(
      "This invitation was sent to a different email address",
      403,
      "FORBIDDEN",
    );
  }
  if (invitation.workspace.deletedAt) {
    throw new AppError("Workspace not found", 404, "WORKSPACE_NOT_FOUND");
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: invitation.workspaceId,
        userId,
      },
    },
  });
  if (existing) {
    await prisma.workspaceInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
    throw new AppError(
      "You are already a member of this workspace",
      409,
      "MEMBER_ALREADY_EXISTS",
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspaceMember.create({
      data: {
        workspaceId: invitation.workspaceId,
        userId,
        roleId: invitation.roleId,
        invitedBy: invitation.invitedBy,
      },
    });
    await tx.workspaceInvitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
    await tx.activity.create({
      data: {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        entityType: ActivityEntityType.WORKSPACE,
        entityId: invitation.workspaceId,
        action: ActivityAction.UPDATE,
        metadata: { type: "member_joined", email: userEmail },
      },
    });
  });

  return {
    message: "Invitation accepted",
    workspaceId: invitation.workspaceId,
  };
}

export async function rejectInvitation(userEmail: string, rawToken: string) {
  const invitation = await prisma.workspaceInvitation.findUnique({
    where: { token: hashToken(rawToken) },
  });
  if (!invitation || invitation.status !== InvitationStatus.PENDING) {
    throw new AppError("Invalid or expired invitation", 400, "INVITATION_EXPIRED");
  }
  if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new AppError(
      "This invitation was sent to a different email address",
      403,
      "FORBIDDEN",
    );
  }

  await prisma.workspaceInvitation.update({
    where: { id: invitation.id },
    data: {
      status: InvitationStatus.REJECTED,
      rejectedAt: new Date(),
    },
  });

  return { message: "Invitation rejected" };
}

export async function changeMemberRole(
  workspaceId: string,
  actorId: string,
  memberId: string,
  roleId: string,
  workspaceOwnerId: string,
) {
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    include: { role: true },
  });
  if (!member) {
    throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
  }
  if (member.userId === workspaceOwnerId) {
    throw new AppError(
      "Cannot change the owner's role. Transfer ownership instead.",
      400,
      "CANNOT_CHANGE_OWNER_ROLE",
    );
  }

  const role = await prisma.workspaceRole.findFirst({
    where: { id: roleId, workspaceId },
  });
  if (!role) {
    throw new AppError("Role not found in this workspace", 404, "ROLE_NOT_FOUND");
  }
  if (role.name === "Owner") {
    throw new AppError(
      "Cannot assign Owner via role change. Transfer ownership instead.",
      400,
      "INVALID_ROLE",
    );
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: memberId },
    data: { roleId },
    include: {
      role: true,
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
  });

  await notifyUser({
    workspaceId,
    recipientId: member.userId,
    senderId: actorId,
    entityType: NotificationEntityType.MEMBER,
    entityId: member.id,
    notificationType: NotificationType.ROLE_UPDATED,
    title: "Role updated",
    message: `Your workspace role was changed to ${role.name}.`,
  });

  await logActivity({
    workspaceId,
    actorId,
    entityId: memberId,
    action: ActivityAction.UPDATE,
    metadata: { type: "role_changed", role: role.name },
  });

  return {
    id: updated.id,
    role: { id: updated.role.id, name: updated.role.name },
    user: {
      id: updated.user.id,
      fullName: updated.user.fullName,
      email: updated.user.email,
      username: updated.user.username,
      avatar: updated.user.avatarUrl,
    },
  };
}

export async function removeMember(
  workspaceId: string,
  actorId: string,
  memberId: string,
  workspaceOwnerId: string,
) {
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
  });
  if (!member) {
    throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
  }
  if (member.userId === workspaceOwnerId) {
    throw new AppError("Cannot remove the workspace owner", 400, "CANNOT_REMOVE_OWNER");
  }

  await prisma.workspaceMember.delete({ where: { id: memberId } });

  await notifyUser({
    workspaceId,
    recipientId: member.userId,
    senderId: actorId,
    entityType: NotificationEntityType.MEMBER,
    entityId: memberId,
    notificationType: NotificationType.SYSTEM,
    title: "Removed from workspace",
    message: "You were removed from a workspace.",
  });

  await logActivity({
    workspaceId,
    actorId,
    entityId: memberId,
    action: ActivityAction.DELETE,
    metadata: { type: "member_removed" },
  });

  return { message: "Member removed successfully" };
}

export async function leaveWorkspace(
  workspaceId: string,
  userId: string,
  workspaceOwnerId: string,
) {
  if (userId === workspaceOwnerId) {
    throw new AppError(
      "Owners must transfer ownership before leaving the workspace",
      400,
      "OWNER_REQUIRED",
    );
  }

  const member = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId },
    },
  });
  if (!member) {
    throw new AppError(
      "You are not a member of this workspace",
      403,
      "NOT_WORKSPACE_MEMBER",
    );
  }

  await prisma.workspaceMember.delete({ where: { id: member.id } });
  await logActivity({
    workspaceId,
    actorId: userId,
    entityId: member.id,
    action: ActivityAction.DELETE,
    metadata: { type: "member_left" },
  });

  return { message: "You left the workspace" };
}

export async function transferOwnership(
  workspaceId: string,
  currentOwnerId: string,
  memberId: string,
) {
  const member = await prisma.workspaceMember.findFirst({
    where: { id: memberId, workspaceId },
    include: { role: true },
  });
  if (!member) {
    throw new AppError("Member not found", 404, "MEMBER_NOT_FOUND");
  }
  if (member.userId === currentOwnerId) {
    throw new AppError("You already own this workspace", 400, "BAD_REQUEST");
  }

  const roles = await prisma.workspaceRole.findMany({
    where: { workspaceId, name: { in: ["Owner", "Admin"] } },
  });
  const ownerRole = roles.find((r) => r.name === "Owner");
  const adminRole = roles.find((r) => r.name === "Admin");
  if (!ownerRole || !adminRole) {
    throw new AppError("System roles are missing", 500, "INTERNAL_ERROR");
  }

  const currentOwnerMember = await prisma.workspaceMember.findUnique({
    where: {
      workspaceId_userId: { workspaceId, userId: currentOwnerId },
    },
  });
  if (!currentOwnerMember) {
    throw new AppError("Owner membership missing", 500, "INTERNAL_ERROR");
  }

  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({
      where: { id: workspaceId },
      data: { ownerId: member.userId },
    });
    await tx.workspaceMember.update({
      where: { id: member.id },
      data: { roleId: ownerRole.id },
    });
    await tx.workspaceMember.update({
      where: { id: currentOwnerMember.id },
      data: { roleId: adminRole.id },
    });
    await tx.activity.create({
      data: {
        workspaceId,
        actorId: currentOwnerId,
        entityType: ActivityEntityType.WORKSPACE,
        entityId: workspaceId,
        action: ActivityAction.UPDATE,
        metadata: { type: "ownership_transferred", toUserId: member.userId },
      },
    });
    await tx.notification.create({
      data: {
        workspaceId,
        recipientId: member.userId,
        senderId: currentOwnerId,
        entityType: NotificationEntityType.WORKSPACE,
        entityId: workspaceId,
        notificationType: NotificationType.ROLE_UPDATED,
        title: "You are the new owner",
        message: "Workspace ownership was transferred to you.",
      },
    });
  });

  return { message: "Ownership transferred successfully" };
}

export async function getSettings(workspaceId: string) {
  const settings = await prisma.workspaceSetting.findUnique({
    where: { workspaceId },
  });
  if (!settings) {
    throw new AppError("Workspace settings not found", 404, "NOT_FOUND");
  }
  return settings;
}

export async function updateSettings(
  workspaceId: string,
  actorId: string,
  input: UpdateSettingsInput,
) {
  const settings = await prisma.workspaceSetting.update({
    where: { workspaceId },
    data: input,
  });
  await logActivity({
    workspaceId,
    actorId,
    entityId: workspaceId,
    action: ActivityAction.UPDATE,
    metadata: { type: "settings_updated", ...input },
  });
  return settings;
}

export async function getStorage(workspaceId: string) {
  const storage = await prisma.workspaceStorage.findUnique({
    where: { workspaceId },
  });
  if (!storage) {
    throw new AppError("Workspace storage not found", 404, "NOT_FOUND");
  }
  return {
    usedStorage: Number(storage.usedStorage),
    maxStorage: Number(storage.maxStorage),
    imageSize: Number(storage.imageSize),
    videoSize: Number(storage.videoSize),
    documentSize: Number(storage.documentSize),
  };
}
