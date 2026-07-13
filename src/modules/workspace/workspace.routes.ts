import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import {
  requireOwner,
  requirePermission,
  requireWorkspaceMember,
} from "../../middleware/workspace.js";
import * as workspaceController from "./workspace.controller.js";

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);

workspaceRouter.post("/", workspaceController.create);
workspaceRouter.get("/", workspaceController.listMine);

workspaceRouter.post("/invitations/accept", workspaceController.acceptInvite);
workspaceRouter.post("/invitations/reject", workspaceController.rejectInvite);

workspaceRouter.get(
  "/:workspaceId",
  requireWorkspaceMember,
  workspaceController.getOne,
);
workspaceRouter.patch(
  "/:workspaceId",
  requireWorkspaceMember,
  requirePermission("workspace:update"),
  workspaceController.update,
);
workspaceRouter.delete(
  "/:workspaceId",
  requireWorkspaceMember,
  requireOwner,
  workspaceController.remove,
);

workspaceRouter.get(
  "/:workspaceId/roles",
  requireWorkspaceMember,
  workspaceController.listRoles,
);
workspaceRouter.get(
  "/:workspaceId/members",
  requireWorkspaceMember,
  workspaceController.listMembers,
);
workspaceRouter.post(
  "/:workspaceId/invitations",
  requireWorkspaceMember,
  requirePermission("member:invite"),
  workspaceController.invite,
);
workspaceRouter.patch(
  "/:workspaceId/members/:memberId",
  requireWorkspaceMember,
  requirePermission("member:change_role"),
  workspaceController.changeRole,
);
workspaceRouter.delete(
  "/:workspaceId/members/:memberId",
  requireWorkspaceMember,
  requirePermission("member:remove"),
  workspaceController.removeMember,
);
workspaceRouter.post(
  "/:workspaceId/leave",
  requireWorkspaceMember,
  workspaceController.leave,
);
workspaceRouter.post(
  "/:workspaceId/transfer-owner",
  requireWorkspaceMember,
  requireOwner,
  workspaceController.transferOwner,
);

workspaceRouter.get(
  "/:workspaceId/settings",
  requireWorkspaceMember,
  workspaceController.getSettings,
);
workspaceRouter.patch(
  "/:workspaceId/settings",
  requireWorkspaceMember,
  requirePermission("settings:manage"),
  workspaceController.updateSettings,
);
workspaceRouter.get(
  "/:workspaceId/storage",
  requireWorkspaceMember,
  workspaceController.getStorage,
);
