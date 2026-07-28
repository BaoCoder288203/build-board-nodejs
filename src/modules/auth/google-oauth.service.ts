import * as argon2 from "argon2";
import { OAuthProvider } from "@prisma/client";
import crypto from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { AppError } from "../../common/app-error.js";
import { env } from "../../config/env.js";
import { prisma } from "../../database/prisma.js";
import { generateOpaqueToken } from "../../utils/token.js";
import * as authService from "./auth.service.js";

type OAuthMode = "login" | "link";

type GoogleProfile = {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
};

type OAuthStatePayload = {
  mode: OAuthMode;
  userId?: string;
  returnTo?: string;
  nonce: string;
  exp: number;
};

export function isGoogleOAuthEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function googleCallbackUrl() {
  return (
    env.GOOGLE_CALLBACK_URL ??
    `${env.APP_URL}${env.API_PREFIX}/auth/google/callback`
  );
}

function getOAuthClient() {
  if (!isGoogleOAuthEnabled()) {
    throw new AppError(
      "Google OAuth is not configured",
      503,
      "OAUTH_NOT_CONFIGURED",
    );
  }

  return new OAuth2Client(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    googleCallbackUrl(),
  );
}

function signState(payload: {
  mode: OAuthMode;
  userId?: string;
  returnTo?: string;
}) {
  const body: OAuthStatePayload = {
    ...payload,
    nonce: generateOpaqueToken(8),
    exp: Date.now() + 10 * 60 * 1000,
  };
  const data = JSON.stringify(body);
  const sig = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(data)
    .digest("base64url");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

function verifyState(state: string): OAuthStatePayload {
  let parsed: { data?: string; sig?: string };
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8")) as {
      data?: string;
      sig?: string;
    };
  } catch {
    throw new AppError("Invalid OAuth state", 400, "OAUTH_FAILED");
  }

  if (!parsed.data || !parsed.sig) {
    throw new AppError("Invalid OAuth state", 400, "OAUTH_FAILED");
  }

  const expected = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(parsed.data)
    .digest("base64url");

  if (expected !== parsed.sig) {
    throw new AppError("Invalid OAuth state", 400, "OAUTH_FAILED");
  }

  const payload = JSON.parse(parsed.data) as OAuthStatePayload;
  if (!payload.exp || payload.exp < Date.now()) {
    throw new AppError("OAuth state expired", 400, "OAUTH_FAILED");
  }

  return payload;
}

export function getGoogleAuthRedirectUrl(mode: OAuthMode, userId?: string) {
  const client = getOAuthClient();
  const returnTo = mode === "link" ? "/profile" : "/dashboard";
  const state = signState({ mode, userId, returnTo });

  return client.generateAuthUrl({
    access_type: "online",
    scope: ["openid", "email", "profile"],
    state,
    prompt: mode === "link" ? "consent" : "select_account",
  });
}

async function uniqueUsernameFromEmail(email: string) {
  const base =
    email
      .split("@")[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 24) || "user";

  let candidate = base;
  let i = 0;
  while (await prisma.user.findUnique({ where: { username: candidate } })) {
    i += 1;
    candidate = `${base}${i}`;
  }
  return candidate;
}

async function syncAvatarFromGoogle(userId: string, picture?: string) {
  if (!picture) return;
  await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: picture },
  });
}

async function fetchGoogleProfile(code: string): Promise<GoogleProfile> {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new AppError(
      "Google did not return an ID token",
      400,
      "OAUTH_FAILED",
    );
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID!,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email) {
    throw new AppError("Google profile is incomplete", 400, "OAUTH_FAILED");
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified ?? false,
    name: payload.name,
    picture: payload.picture,
  };
}

async function findOrCreateUserFromGoogle(
  profile: GoogleProfile,
  linkUserId?: string,
) {
  const existingOAuth = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: OAuthProvider.GOOGLE,
        providerAccountId: profile.sub,
      },
    },
    include: { user: true },
  });

  if (existingOAuth) {
    if (linkUserId && existingOAuth.userId !== linkUserId) {
      throw new AppError(
        "This Google account is already linked to another user",
        409,
        "OAUTH_ACCOUNT_TAKEN",
      );
    }
    await syncAvatarFromGoogle(existingOAuth.userId, profile.picture);
    return existingOAuth.user;
  }

  if (linkUserId) {
    const user = await prisma.user.findUnique({ where: { id: linkUserId } });
    if (!user || user.deletedAt) {
      throw new AppError("User not found", 404, "USER_NOT_FOUND");
    }
    if (user.email.toLowerCase() !== profile.email) {
      throw new AppError(
        "Google account email must match your BuildBoard email",
        409,
        "OAUTH_EMAIL_MISMATCH",
      );
    }

    await prisma.oAuthAccount.create({
      data: {
        userId: linkUserId,
        provider: OAuthProvider.GOOGLE,
        providerAccountId: profile.sub,
      },
    });
    await syncAvatarFromGoogle(linkUserId, profile.picture);
    return user;
  }

  const byEmail = await prisma.user.findUnique({
    where: { email: profile.email },
  });

  if (byEmail && !byEmail.deletedAt) {
    await prisma.oAuthAccount.create({
      data: {
        userId: byEmail.id,
        provider: OAuthProvider.GOOGLE,
        providerAccountId: profile.sub,
      },
    });
    if (profile.emailVerified && !byEmail.isVerified) {
      await prisma.user.update({
        where: { id: byEmail.id },
        data: { isVerified: true },
      });
    }
    await syncAvatarFromGoogle(byEmail.id, profile.picture);
    return byEmail;
  }

  const passwordHash = await argon2.hash(generateOpaqueToken(32));
  const username = await uniqueUsernameFromEmail(profile.email);

  return prisma.user.create({
    data: {
      email: profile.email,
      fullName: profile.name ?? profile.email.split("@")[0] ?? "User",
      username,
      passwordHash,
      avatarUrl: profile.picture ?? null,
      isActive: true,
      isVerified: profile.emailVerified,
      notificationSettings: { create: {} },
      oauthAccounts: {
        create: {
          provider: OAuthProvider.GOOGLE,
          providerAccountId: profile.sub,
        },
      },
    },
  });
}

export async function handleGoogleCallback(
  code: string | undefined,
  state: string | undefined,
  oauthError: string | undefined,
  meta?: { ip?: string; userAgent?: string },
) {
  if (oauthError) {
    throw new AppError("Google sign-in was cancelled", 400, "OAUTH_DENIED");
  }
  if (!code || !state) {
    throw new AppError("Missing OAuth callback parameters", 400, "OAUTH_FAILED");
  }

  const statePayload = verifyState(state);
  const profile = await fetchGoogleProfile(code);
  const user = await findOrCreateUserFromGoogle(
    profile,
    statePayload.mode === "link" ? statePayload.userId : undefined,
  );

  if (!user.isActive || user.deletedAt) {
    throw new AppError("Account is disabled", 403, "ACCOUNT_DISABLED");
  }

  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const session = await authService.loginWithUser(fresh, meta);

  return {
    ...session,
    returnTo: statePayload.returnTo ?? "/dashboard",
  };
}

export function getAuthProviders() {
  return {
    google: isGoogleOAuthEnabled(),
  };
}
