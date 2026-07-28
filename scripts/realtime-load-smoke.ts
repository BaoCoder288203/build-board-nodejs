/**
 * Realtime load smoke — opens N authenticated sockets, joins a room, holds briefly.
 *
 * Usage:
 *   npx tsx scripts/realtime-load-smoke.ts \
 *     --token=<access_jwt> \
 *     --room=board:<uuid> \
 *     --clients=25 \
 *     --holdMs=5000
 *
 * Optional:
 *   --url=http://localhost:5000
 */
import { io, type Socket } from "socket.io-client";

function arg(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  return hit.slice(prefix.length);
}

const token = arg("token");
const room = arg("room");
const clients = Number(arg("clients", "10"));
const holdMs = Number(arg("holdMs", "5000"));
const url = (arg("url", process.env.APP_URL ?? "http://localhost:5000") ?? "").replace(
  /\/$/,
  "",
);

if (!token || !room) {
  console.error(
    "Missing required flags. Example:\n" +
      "  npx tsx scripts/realtime-load-smoke.ts --token=... --room=board:<uuid> --clients=25",
  );
  process.exit(1);
}

if (!Number.isFinite(clients) || clients < 1 || clients > 500) {
  console.error("--clients must be between 1 and 500");
  process.exit(1);
}

type Result = {
  id: number;
  connected: boolean;
  joined: boolean;
  error?: string;
};

async function runClient(id: number): Promise<Result> {
  return new Promise((resolve) => {
    const socket: Socket = io(`${url}/rt`, {
      transports: ["websocket"],
      auth: { token },
      reconnection: false,
      timeout: 12_000,
    });

    const done = (result: Result) => {
      socket.disconnect();
      resolve(result);
    };

    const timer = setTimeout(() => {
      done({
        id,
        connected: socket.connected,
        joined: false,
        error: "timeout",
      });
    }, holdMs + 8_000);

    socket.on("connect", () => {
      socket.emit("room:join", { room });
    });

    socket.on("room:joined", (payload: { room?: string }) => {
      if (payload?.room !== room) return;
      setTimeout(() => {
        clearTimeout(timer);
        done({ id, connected: true, joined: true });
      }, holdMs);
    });

    socket.on("socket:error", (payload: { message?: string }) => {
      clearTimeout(timer);
      done({
        id,
        connected: socket.connected,
        joined: false,
        error: payload?.message ?? "socket:error",
      });
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      done({
        id,
        connected: false,
        joined: false,
        error: error.message,
      });
    });
  });
}

const started = Date.now();
console.log(
  JSON.stringify({
    event: "smoke_start",
    url,
    room,
    clients,
    holdMs,
  }),
);

const results = await Promise.all(
  Array.from({ length: clients }, (_, i) => runClient(i + 1)),
);

const joined = results.filter((r) => r.joined).length;
const failed = results.filter((r) => !r.joined);
console.log(
  JSON.stringify({
    event: "smoke_done",
    elapsedMs: Date.now() - started,
    clients,
    joined,
    failed: failed.length,
    sampleErrors: failed.slice(0, 5).map((f) => f.error),
  }),
);

process.exit(failed.length === 0 ? 0 : 1);
