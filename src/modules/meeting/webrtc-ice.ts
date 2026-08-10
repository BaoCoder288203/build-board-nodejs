import { createHmac } from "node:crypto";

export type IceServerConfig = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

const DEFAULT_STUN: IceServerConfig[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

function splitUrls(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function iceTransportPolicy(): "all" | "relay" {
  const policyRaw = (process.env.WEBRTC_ICE_TRANSPORT_POLICY || "all")
    .trim()
    .toLowerCase();
  return policyRaw === "relay" ? "relay" : "all";
}

function normalizeIceServers(raw: unknown): IceServerConfig[] {
  if (!raw) return [];
  // Cloudflare generate-ice-servers may return array or single object
  if (Array.isArray(raw)) {
    return raw.filter(Boolean) as IceServerConfig[];
  }
  if (typeof raw === "object" && raw !== null && "urls" in raw) {
    return [raw as IceServerConfig];
  }
  return [];
}

/**
 * Cloudflare Realtime TURN — short-lived credentials via API.
 * Env: CLOUDFLARE_TURN_TOKEN_ID + CLOUDFLARE_TURN_API_TOKEN
 * Docs: https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */
async function fetchCloudflareIceServers(): Promise<IceServerConfig[] | null> {
  const keyId = process.env.CLOUDFLARE_TURN_TOKEN_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId || !apiToken) return null;

  const ttl = Math.min(
    172_800,
    Math.max(60, Number(process.env.WEBRTC_TURN_CREDENTIAL_TTL || 86_400) || 86_400),
  );

  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Cloudflare TURN credentials failed (${res.status}): ${body.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { iceServers?: unknown };
  const servers = normalizeIceServers(data.iceServers);
  if (servers.length === 0) {
    throw new Error("Cloudflare TURN returned empty iceServers");
  }
  return servers;
}

/**
 * Static / coturn-style ICE servers from env.
 *
 * Env:
 * - WEBRTC_STUN_URLS
 * - WEBRTC_TURN_URLS + WEBRTC_TURN_USERNAME/CREDENTIAL or WEBRTC_TURN_SECRET
 */
function buildStaticIceServers(userId?: string): IceServerConfig[] {
  const stunUrls = splitUrls(process.env.WEBRTC_STUN_URLS);
  const turnUrls = splitUrls(process.env.WEBRTC_TURN_URLS);
  const iceServers: IceServerConfig[] = [];

  if (stunUrls.length > 0) {
    iceServers.push({ urls: stunUrls.length === 1 ? stunUrls[0]! : stunUrls });
  } else {
    iceServers.push(...DEFAULT_STUN);
  }

  if (turnUrls.length > 0) {
    const secret = process.env.WEBRTC_TURN_SECRET?.trim();
    const staticUser = process.env.WEBRTC_TURN_USERNAME?.trim();
    const staticCred = process.env.WEBRTC_TURN_CREDENTIAL?.trim();

    let username: string | undefined;
    let credential: string | undefined;

    if (secret) {
      const ttl = Math.max(
        60,
        Number(process.env.WEBRTC_TURN_CREDENTIAL_TTL || 86_400) || 86_400,
      );
      const expiry = Math.floor(Date.now() / 1000) + ttl;
      username = `${expiry}:${userId || "bb"}`;
      credential = createHmac("sha1", secret).update(username).digest("base64");
    } else if (staticUser && staticCred) {
      username = staticUser;
      credential = staticCred;
    }

    if (username && credential) {
      iceServers.push({
        urls: turnUrls.length === 1 ? turnUrls[0]! : turnUrls,
        username,
        credential,
      });
    }
  }

  return iceServers;
}

/**
 * Resolve ICE servers for WebRTC meetings.
 * Priority: Cloudflare TURN API → static coturn/env → STUN only.
 */
export async function resolveIceServers(userId?: string): Promise<{
  iceServers: IceServerConfig[];
  iceTransportPolicy: "all" | "relay";
}> {
  const policy = iceTransportPolicy();

  try {
    const cloudflare = await fetchCloudflareIceServers();
    if (cloudflare) {
      return { iceServers: cloudflare, iceTransportPolicy: policy };
    }
  } catch (error) {
    console.error("[webrtc-ice] Cloudflare TURN failed, falling back", error);
  }

  return {
    iceServers: buildStaticIceServers(userId),
    iceTransportPolicy: policy,
  };
}

/** @deprecated use resolveIceServers */
export function buildIceServers(userId?: string): {
  iceServers: IceServerConfig[];
  iceTransportPolicy: "all" | "relay";
} {
  return {
    iceServers: buildStaticIceServers(userId),
    iceTransportPolicy: iceTransportPolicy(),
  };
}
