import type { CookieOptions, Response } from "express";
import { env } from "../config/env.js";

const isProd = env.NODE_ENV === "production";

function baseCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE ?? isProd,
    sameSite: env.COOKIE_SAME_SITE,
    path: "/",
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

export function setAuthCookies(
  res: Response,
  accessToken: string,
  refreshToken: string,
) {
  res.cookie("access_token", accessToken, {
    ...baseCookieOptions(),
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refresh_token", refreshToken, {
    ...baseCookieOptions(),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookies(res: Response) {
  const options = baseCookieOptions();
  res.clearCookie("access_token", options);
  res.clearCookie("refresh_token", options);
}
