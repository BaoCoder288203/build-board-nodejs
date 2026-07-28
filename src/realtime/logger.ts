type RealtimeLogLevel = "debug" | "info" | "warn" | "error";

function emit(level: RealtimeLogLevel, event: string, data?: Record<string, unknown>) {
  const line = {
    scope: "rt",
    level,
    event,
    at: new Date().toISOString(),
    ...data,
  };
  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export const rtLog = {
  debug: (event: string, data?: Record<string, unknown>) =>
    emit("debug", event, data),
  info: (event: string, data?: Record<string, unknown>) =>
    emit("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) =>
    emit("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) =>
    emit("error", event, data),
};
