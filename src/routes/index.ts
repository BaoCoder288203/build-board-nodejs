import { Router } from "express";
import { successResponse } from "../common/response.js";
import { env } from "../config/env.js";
import { prisma } from "../database/prisma.js";
import { authRouter } from "../modules/auth/auth.routes.js";
import { boardRouter } from "../modules/board/board.routes.js";
import { columnRouter } from "../modules/column/column.routes.js";
import { projectRouter } from "../modules/project/project.routes.js";
import { workspaceRouter } from "../modules/workspace/workspace.routes.js";

export const router = Router();

router.get("/health", async (_req, res) => {
  let database: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    database = "up";
  } catch {
    database = "down";
  }

  return successResponse(res, {
    app: env.APP_NAME,
    env: env.NODE_ENV,
    database,
    uptime: process.uptime(),
  });
});

router.use("/auth", authRouter);
router.use("/workspaces", workspaceRouter);
router.use("/projects", projectRouter);
router.use("/boards", boardRouter);
router.use("/columns", columnRouter);
