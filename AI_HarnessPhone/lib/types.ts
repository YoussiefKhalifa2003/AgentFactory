import { apiUrl } from "./config";
import { lookSvg, parseLook } from "./look";

export type Strength =
  | "coding"
  | "maths"
  | "research"
  | "writing"
  | "data"
  | "planning"
  | "ops"
  | "review"
  | "brief"
  | "qa"
  | string;

export const STRENGTHS: { id: string; label: string; copy: string }[] = [
  { id: "coding", label: "Coding", copy: "Writes files and runs them" },
  { id: "maths", label: "Maths", copy: "Checks every answer in code" },
  { id: "research", label: "Research", copy: "Looks things up and cites them" },
  { id: "writing", label: "Writing", copy: "Drafts, emails, docs, one-pagers" },
  { id: "data", label: "Data", copy: "Tables, metrics, dashboards" },
  { id: "planning", label: "Planning", copy: "Plans, roadmaps, breakdowns" },
  { id: "ops", label: "Ops", copy: "Follow-ups, process, coordination" },
  { id: "review", label: "Review", copy: "Findings, severity, what to fix" },
  { id: "brief", label: "Brief", copy: "Situation, so-what, one ask" },
  { id: "qa", label: "QA", copy: "Writes tests and runs them" },
];

export type Agent = {
  id: string;
  name: string;
  description: string;
  pigment: string;
  pfp: string | null;
  strengths: string[];
  model: string;
  instructions: string;
  look?: Record<string, string> | null;
};

export type Artifact = {
  id: string;
  job_id: string;
  agent_id: string;
  name: string;
  kind: string;
  path?: string;
  mime?: string | null;
  created_at?: string;
};

export type Job = {
  id: string;
  agent_id: string;
  prompt: string;
  status: string;
  activity: string;
  caption: string;
  output: string;
  error: string | null;
  task_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  chain_id?: string | null;
  chain_step_id?: string | null;
  created_at?: string;
  artifacts?: Artifact[];
};

export type PlantSlot = {
  ok?: boolean;
  locked?: boolean;
  busy?: boolean;
  agentId?: string | null;
  agentName?: string | null;
  jobId?: string | null;
  reason?: string | null;
  inFlight?: number;
};

export type PlantSnapshot = {
  local: PlantSlot;
  spark1: PlantSlot;
  spark2: PlantSlot;
  openrouter?: PlantSlot;
  zen?: PlantSlot;
  cloud?: PlantSlot;
};

export type ShiftNote = {
  id?: string;
  note?: string;
  open?: boolean;
  ended_at?: string | null;
  started_at?: string | null;
};

export type ChainStep = {
  id: string;
  seq: number;
  agent_id?: string;
  status?: string;
};

export type Chain = {
  id: string;
  status?: string;
  steps: ChainStep[];
};

export type TaskStatus = "open" | "assigned" | "working" | "done" | "blocked";

export type TaskList = {
  id: string;
  title: string;
  kind: "inbox" | "custom" | "meeting" | "done" | string;
  item_count: number;
  open_count: number;
  working_count: number;
  done_count: number;
  project?: { id: string; name: string; title?: string } | null;
};

export type ListItem = {
  id: string;
  list_id: string;
  text: string;
  prompt: string;
  suggested: Strength;
  status: TaskStatus;
  agent_id: string | null;
  job_id: string | null;
  mine: boolean;
  recap?: string | null;
  artifact?: Artifact | null;
  virtual?: boolean;
};

export type LiveState = {
  job: Job | null;
  tokens: string;
  think: string;
  artifacts: Artifact[];
};

export function pfpSrc(api: string, pfp: string | null | undefined): string | null {
  if (!pfp) return null;
  if (pfp.startsWith("http") || pfp.startsWith("data:")) return pfp;
  return `${api}${pfp}`;
}

export function badgeDataUrl(name: string, pigment: string): string {
  const initial = (name.trim()[0] || "?").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <rect width="256" height="256" rx="64" fill="${pigment}"/>
    <text x="128" y="168" text-anchor="middle" font-size="128" font-family="Georgia, serif" fill="#fff7ee">${initial}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function strengthLabel(s: string): string {
  return STRENGTHS.find((row) => row.id === s)?.label || s.charAt(0).toUpperCase() + s.slice(1);
}

export function taskTitle(item: { text?: string; prompt?: string } | null | undefined) {
  if (item?.text?.trim()) return item.text.trim();
  const src = item?.prompt || "";
  const match = src.match(/^(?:Action|Task):\s*(.+)$/m);
  return (match?.[1] || src.split("\n")[0] || "Task").trim();
}

export function bayCopy(agent: Agent) {
  const desc = (agent.description || "").trim();
  if (desc) return desc;
  const first = agent.strengths?.[0];
  return STRENGTHS.find((row) => row.id === first)?.copy || "";
}

export function portrait(agent: Agent) {
  if (agent.pfp) return pfpSrc(apiUrl(), agent.pfp);
  return lookSvg(parseLook(agent.look, agent.name, agent.pigment), agent.pigment);
}

export function statusLabel(activity?: string, status?: string) {
  if (["queued", "thinking", "tool"].includes(status || activity || "")) return "Working";
  if (status === "done" || activity === "done") return "Done";
  if (status === "blocked" || activity === "blocked") return "Needs attention";
  if (status === "cancelled") return "Cancelled";
  return "Ready";
}
