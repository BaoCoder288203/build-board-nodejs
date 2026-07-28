import type { Socket } from "socket.io";
import { prisma } from "../database/prisma.js";
import { verifyAccessToken } from "../utils/token.js";

export type SocketUser = {
  id: string;
  email: string;
  fullName: string;
  avatar: string | null;
};

function parseCookie(cookieHeader: string | undefined, key: string) {
  if (!cookieHeader) return null;
  const chunks = cookieHeader.split(";").map((part) => part.trim());
  for (const chunk of chunks) {
    if (!chunk.startsWith(`${key}=`)) continue;
    return decodeURIComponent(chunk.slice(key.length + 1));
  }
  return null;
}

function extractBearer(socket: Socket) {
  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  return null;
}

function extractToken(socket: Socket) {
  const fromAuth = socket.handshake.auth?.token;
  if (typeof fromAuth === "string" && fromAuth.trim().length > 0) {
    return fromAuth;
  }
  return (
    extractBearer(socket) ??
    parseCookie(socket.handshake.headers.cookie, "access_token")
  );
}

export async function authenticateSocket(socket: Socket) {
  const token = extractToken(socket);
  if (!token) {
    throw new Error("Missing auth token");
  }

  const payload = verifyAccessToken(token);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive || user.deletedAt) {
    throw new Error("Unauthorized user");
  }

  const socketUser: SocketUser = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatar: user.avatarUrl,
  };

  socket.data.user = socketUser;
  return socketUser;
}
