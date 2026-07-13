import { PrismaClient, ProjectMemberRole } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

const SYSTEM_ROLES = [
  {
    name: "Owner",
    description: "Full control over the workspace",
    permissions: [
      "workspace:update",
      "workspace:delete",
      "workspace:archive",
      "member:invite",
      "member:remove",
      "member:change_role",
      "project:create",
      "project:update",
      "project:delete",
      "task:create",
      "task:update",
      "task:delete",
      "board:manage",
      "settings:manage",
    ],
  },
  {
    name: "Admin",
    description: "Manage members, projects and settings",
    permissions: [
      "workspace:update",
      "member:invite",
      "member:remove",
      "member:change_role",
      "project:create",
      "project:update",
      "project:delete",
      "task:create",
      "task:update",
      "task:delete",
      "board:manage",
      "settings:manage",
    ],
  },
  {
    name: "Project Manager",
    description: "Manage projects, boards and tasks",
    permissions: [
      "project:create",
      "project:update",
      "task:create",
      "task:update",
      "task:delete",
      "board:manage",
      "member:invite",
    ],
  },
  {
    name: "Developer",
    description: "Work on assigned tasks",
    permissions: [
      "task:create",
      "task:update",
      "project:view",
      "board:view",
    ],
  },
  {
    name: "Viewer",
    description: "Read-only access",
    permissions: ["project:view", "board:view", "task:view"],
  },
] as const;

async function main() {
  console.log("🌱 Seeding Phase 1 data...");

  const passwordHash = await argon2.hash("Password123!");

  const user = await prisma.user.upsert({
    where: { email: "admin@buildboard.local" },
    update: {},
    create: {
      email: "admin@buildboard.local",
      username: "admin",
      fullName: "BuildBoard Admin",
      passwordHash,
      isActive: true,
      isVerified: true,
      timezone: "Asia/Ho_Chi_Minh",
      language: "en",
      notificationSettings: {
        create: {},
      },
    },
  });

  console.log(`✓ User: ${user.email}`);

  const workspace = await prisma.workspace.upsert({
    where: { slug: "demo-workspace" },
    update: {},
    create: {
      name: "Demo Workspace",
      slug: "demo-workspace",
      description: "Seed workspace for local development",
      ownerId: user.id,
      visibility: "PRIVATE",
      timezone: "Asia/Ho_Chi_Minh",
      settings: {
        create: {
          defaultLanguage: "en",
          defaultTimezone: "Asia/Ho_Chi_Minh",
        },
      },
      storage: {
        create: {},
      },
    },
  });

  console.log(`✓ Workspace: ${workspace.slug}`);

  const roleMap = new Map<string, string>();

  for (const roleDef of SYSTEM_ROLES) {
    const role = await prisma.workspaceRole.upsert({
      where: {
        workspaceId_name: {
          workspaceId: workspace.id,
          name: roleDef.name,
        },
      },
      update: {
        description: roleDef.description,
        isSystem: true,
      },
      create: {
        workspaceId: workspace.id,
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

  console.log(`✓ System roles: ${SYSTEM_ROLES.length}`);

  const ownerRoleId = roleMap.get("Owner");
  if (!ownerRoleId) {
    throw new Error("Owner role missing after seed");
  }

  await prisma.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
    update: {
      roleId: ownerRoleId,
    },
    create: {
      workspaceId: workspace.id,
      userId: user.id,
      roleId: ownerRoleId,
    },
  });

  console.log("✓ Owner membership");

  const project = await prisma.project.upsert({
    where: {
      workspaceId_slug: {
        workspaceId: workspace.id,
        slug: "demo-project",
      },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      ownerId: user.id,
      name: "Demo Project",
      slug: "demo-project",
      description: "Seed project with default board",
      color: "#2563EB",
      visibility: "WORKSPACE",
      statuses: {
        create: [
          { name: "Todo", color: "#94A3B8", position: 0, isDefault: true },
          { name: "In Progress", color: "#3B82F6", position: 1 },
          { name: "Review", color: "#F59E0B", position: 2 },
          { name: "Done", color: "#22C55E", position: 3 },
        ],
      },
      labels: {
        create: [
          { name: "Bug", color: "#EF4444" },
          { name: "Feature", color: "#8B5CF6" },
          { name: "Improvement", color: "#06B6D4" },
        ],
      },
    },
  });

  console.log(`✓ Project: ${project.slug}`);

  const member = await prisma.workspaceMember.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: workspace.id,
        userId: user.id,
      },
    },
  });

  await prisma.projectMember.upsert({
    where: {
      projectId_workspaceMemberId: {
        projectId: project.id,
        workspaceMemberId: member.id,
      },
    },
    update: {},
    create: {
      projectId: project.id,
      workspaceMemberId: member.id,
      role: ProjectMemberRole.OWNER,
    },
  });

  let board = await prisma.board.findFirst({
    where: { projectId: project.id, isDefault: true, deletedAt: null },
  });

  if (!board) {
    board = await prisma.board.create({
      data: {
        projectId: project.id,
        name: "Main Board",
        position: 0,
        isDefault: true,
        createdBy: user.id,
        columns: {
          create: [
            {
              name: "Todo",
              position: 0,
              isDefault: true,
              createdBy: user.id,
            },
            {
              name: "In Progress",
              position: 1,
              createdBy: user.id,
            },
            {
              name: "Done",
              position: 2,
              isDone: true,
              createdBy: user.id,
            },
          ],
        },
      },
    });
  }

  console.log(`✓ Board: ${board.name}`);
  console.log("✅ Seed completed");
  console.log("   Login: admin@buildboard.local / Password123!");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
