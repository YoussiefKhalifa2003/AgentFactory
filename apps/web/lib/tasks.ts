import { Agent, ListItem, Strength } from "./types";

export const TASK_MIME = "application/x-foundry-task";

export function taskDragPayload(item: ListItem) {
  return JSON.stringify(item);
}

export function parseTaskDrag(data: DataTransfer): ListItem | null {
  const raw =
    data.getData(TASK_MIME) ||
    data.getData("application/x-meeting-action") ||
    data.getData("text/plain");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ListItem & { prompt?: string; id?: string };
    if (!parsed?.id) return null;
    if (!parsed.prompt && parsed.text) parsed.prompt = parsed.text;
    return parsed as ListItem;
  } catch {
    return null;
  }
}

export function pickBestAgent(agents: Agent[], suggested: Strength) {
  return agents.find((a) => a.strengths.includes(suggested)) || agents[0];
}

export function taskTitle(item: { text?: string; prompt?: string } | null | undefined) {
  if (item?.text?.trim()) return item.text.trim();
  const src = item?.prompt || "";
  const match = src.match(/^(?:Action|Task):\s*(.+)$/m);
  return (match?.[1] || src.split("\n")[0] || "Task").trim();
}
