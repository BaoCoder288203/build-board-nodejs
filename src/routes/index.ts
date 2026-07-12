import { Router } from "express";
import { successResponse } from "../common/response.js";
import { env } from "../config/env.js";
import { prisma } from "../database/prisma.js";

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
