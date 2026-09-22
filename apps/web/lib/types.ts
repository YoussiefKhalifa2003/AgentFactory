export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:8000/ws";

export type Strength =
  | "coding"
  | "maths"
  | "research"
  | "writing"
  | "data"
  | "planning"
  | "ops";

export type SkillPack = { id: string; label: string; copy: string };

export const STRENGTHS: SkillPack[] = [
  { id: "coding", label: "Coding", copy: "Writes files and runs them" },
  { id: "maths", label: "Maths", copy: "Checks every answer in code" },
  { id: "research", label: "Research", copy: "Looks things up and cites them" },
  { id: "writing", label: "Writing", copy: "Drafts, emails, docs, one-pagers" },
  { id: "data", label: "Data", copy: "Tables, metrics, dashboards" },
  { id: "planning", label: "Planning", copy: "Plans, roadmaps, breakdowns" },
  { id: "ops", label: "Ops", copy: "Follow-ups, process, coordination" },
];

export const TOOLS: SkillPack[] = [
  { id: "drawio", label: "draw.io", copy: "Flowcharts and maps that open in draw.io" },
  { id: "spreadsheet", label: "Spreadsheet", copy: "A real sheet you can open as a table" },
  { id: "pdf", label: "PDF", copy: "One printable pack — the file you send" },
];

export type Activity =
  | "idle"
  | "thinking"
  | "tool:sandbox"
  | "tool:web"
  | "write_file"
  | "blocked"
  | "done"
  | string;

export type ModelOption = {
  id: string;
  name: string;
  provider: "local" | "openrouter" | "zen" | string;
  hint: string;
  available: boolean;
  vram?: string;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  pigment: string;
  pfp: string | null;
  strengths: string[];
  model: string;
  instructions: string;
  created_at?: string;
};

export type Artifact = {
  id: string;
  job_id: string;
  agent_id: string;
  name: string;
  kind: string;
  path?: string;
  mime?: string | null;
};

export type Job = {
  id: string;
  agent_id: string;
  prompt: string;
  status: string;
  activity: Activity;
  caption: string;
  output: string;
  error: string | null;
  task_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  created_at?: string;
  updated_at?: string;
  artifacts?: Artifact[];
};

export type LiveState = {
  job: Job | null;
  tokens: string;
  think: string;
  artifacts: Artifact[];
};

export type MeetingAction = {
  id: string;
  meeting_id: number;
  meeting_title: string;
  date: string;
  heading: string;
  text: string;
  owner: string | null;
  mine: boolean;
  suggested: Strength;
  prompt: string;
};

export type Meeting = {
  id: number;
  title: string;
  date: string;
  duration_minutes: number;
  attendees: string[];
  action_count: number;
  mine_count: number;
};

export type TaskStatus = "open" | "assigned" | "working" | "done" | "blocked";

export type TaskList = {
  id: string;
  title: string;
  kind: "inbox" | "custom" | "meeting" | string;
  source?: string | null;
  project_id?: string | null;
  project?: {
    id: string;
    name: string;
    branch: string;
    synced_at?: string | null;
    sync_error?: string | null;
  } | null;
  sort_at?: string;
  item_count: number;
  open_count: number;
  working_count: number;
  done_count: number;
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
  source?: string | null;
  mine: boolean;
};

export function pfpSrc(pfp: string | null | undefined): string | null {
  if (!pfp) return null;
  if (pfp.startsWith("http") || pfp.startsWith("data:")) return pfp;
  return `${API_URL}${pfp}`;
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
  return (
    STRENGTHS.find((row) => row.id === s)?.label ||
    TOOLS.find((row) => row.id === s)?.label ||
    s.charAt(0).toUpperCase() + s.slice(1)
  );
}

export function modelShortName(id: string | undefined): string {
  if (!id) return "auto";
  if (id.startsWith("local:") || id.startsWith("ollama:")) return id.split(":").slice(1).join(":");
  if (id.startsWith("openrouter:")) {
    const rest = id.slice("openrouter:".length);
    return rest.split("/").pop() || rest;
  }
  if (id.startsWith("zen:")) return id.slice(4);
  return id;
}
