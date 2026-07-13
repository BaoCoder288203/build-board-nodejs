import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AccessTokenPayload = {
  sub: string;
  email: string;
  type: "access";
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateOpaqueToken(bytes = 48) {
  return randomBytes(bytes).toString("hex");
}

export function signAccessToken(userId: string, email: string) {
  const payload: AccessTokenPayload = {
    sub: userId,
    email,
    type: "access",
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string) {
  const decoded = jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
  if (decoded.type !== "access") {
    throw new Error("Invalid access token type");
  }
  return decoded;
}

export function getAccessTokenExpiresInSeconds() {
  const match = /^(\d+)([smhd])$/.exec(env.JWT_EXPIRES);
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "s") return value;
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  return value * 86400;
}

export function getRefreshTokenExpiresAt() {
  const match = /^(\d+)([smhd])$/.exec(env.REFRESH_EXPIRES);
  const now = Date.now();
  if (!match) return new Date(now + 30 * 24 * 60 * 60 * 1000);
  const value = Number(match[1]);
  const unit = match[2];
  const ms =
    unit === "s"
      ? value * 1000
      : unit === "m"
        ? value * 60 * 1000
        : unit === "h"
          ? value * 3600 * 1000
          : value * 86400 * 1000;
  return new Date(now + ms);
}
