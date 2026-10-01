export function isWorking(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

export function statusKind(status?: string, activity?: string): "working" | "done" | "blocked" | "queued" | "ready" {
  const s = status || activity || "";
  if (s === "queued") return "queued";
  if (isWorking(s)) return "working";
  if (s === "done") return "done";
  if (s === "blocked") return "blocked";
  return "ready";
}

export function statusLabel(activity?: string, status?: string) {
  const kind = statusKind(status, activity);
  if (kind === "working") return "Working";
  if (kind === "done") return "Done";
  if (kind === "blocked") return "Needs attention";
  if (kind === "queued") return "Queued";
  if (status === "cancelled") return "Stopped";
  return "Ready";
}
