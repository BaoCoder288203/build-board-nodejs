import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/app-error.js";
import { prisma } from "../database/prisma.js";
import { verifyAccessToken } from "../utils/token.js";

export type AuthUser = {
  id: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function extractAccessToken(req: Request) {
  const header = req.get("authorization");
  if (header?.startsWith("Bearer ")) {
    return header.slice(7);
  }
  const cookieToken = req.cookies?.access_token as string | undefined;
  return cookieToken;
}

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }

    const payload = verifyAccessToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });

    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError("Unauthorized", 401, "UNAUTHORIZED");
    }

    req.user = { id: user.id, email: user.email };
    next();
  } catch (error) {
    if (error instanceof AppError) {
      next(error);
      return;
    }
    next(new AppError("Unauthorized", 401, "UNAUTHORIZED"));
  }
}
