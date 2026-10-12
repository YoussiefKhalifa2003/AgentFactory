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
  | "ops"
  | "review"
  | "brief"
  | "qa";

export type SkillPack = { id: string; label: string; copy: string };

export const STRENGTHS: SkillPack[] = [
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

export const TOOLS: SkillPack[] = [
  { id: "drawio", label: "draw.io", copy: "Flowcharts and maps that open in draw.io" },
  { id: "spreadsheet", label: "Spreadsheet", copy: "A real sheet you can open as a table" },
  { id: "pdf", label: "PDF", copy: "One printable pack — the file you send" },
  { id: "slides", label: "Slides", copy: "A deck you can open with View" },
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

export type AgentLook = {
  body: string;
  head: string;
  skin: string;
  hair: string;
  hairColor: string;
  eyes: string;
  brows: string;
  mouth: string;
  outfit: string;
  accessory: string;
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
  look?: AgentLook | null;
  created_at?: string;
};

export type TraceEvent = {
  id?: number;
  kind: string;
  at?: string;
  duration_ms?: number;
  label?: string;
  detail?: string;
  model?: string | null;
  host?: string | null;
  tokens?: number | null;
  payload?: Record<string, unknown>;
};

export type SceneQuality = "high" | "medium" | "low" | "off";

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
  activity: Activity;
  caption: string;
  output: string;
  error: string | null;
  task_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  chain_id?: string | null;
  chain_step_id?: string | null;
  created_at?: string;
  updated_at?: string;
  artifacts?: Artifact[];
};

export type PlantSlot = {
  ok?: boolean;
  locked?: boolean;
  busy?: boolean;
  agentId?: string | null;
  agentName?: string | null;
  jobId?: string | null;
  model?: string | null;
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

export type BrainRepo = {
  id?: string;
  label: string;
  repository?: string;
  branch?: string;
};

export type BrainProject = {
  name: string;
  included: boolean;
  id?: string | null;
  synced_at?: string | null;
  sync_error?: string | null;
  repos: BrainRepo[];
  repo_count: number;
};

export type BrainSnapshot = {
  organization: string;
  wiki_url: string;
  wiki_md: string;
  synced_at?: string | null;
  sync_error?: string | null;
  poll_enabled: boolean;
  has_pat?: boolean;
  studying?: boolean;
  study_files?: number;
  study_repos?: number;
  study_projects?: number;
  projects: BrainProject[];
};

export type ProjectRepo = {
  id: string;
  project_id: string;
  repository: string;
  branch: string;
  label: string;
};

export type Project = {
  id: string;
  name: string;
  title?: string;
  organization?: string;
  project?: string;
  repository?: string;
  branch: string;
  synced_at?: string | null;
  sync_error?: string | null;
  repos?: ProjectRepo[];
};

export type MemoryRow = {
  id: string;
  job_id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  task: string;
  files: string[];
  kind?: string;
  created_at?: string;
};

export type ChainStep = {
  id: string;
  chain_id: string;
  seq: number;
  agent_id?: string | null;
  strength: string;
  prompt: string;
  depends_on?: number | null;
  inherit?: number;
  job_id?: string | null;
  status: string;
};

export type Chain = {
  id: string;
  list_id?: string | null;
  item_id?: string | null;
  project_id?: string | null;
  title?: string;
  status: string;
  created_by?: string;
  steps: ChainStep[];
};

export type PinCard = {
  id: string;
  project_id?: string | null;
  job_id: string;
  artifact_id: string;
  agent_id: string;
  auto?: number;
  created_at?: string;
  artifact?: Artifact | null;
  agent_name?: string;
  caption?: string;
  project_title?: string | null;
};

export type ShiftNote = {
  id: string;
  started_at: string;
  ended_at?: string | null;
  mode?: string;
  note: string;
  jobs_started?: number;
  jobs_done?: number;
  jobs_blocked?: number;
  open?: boolean;
};

export type LiveState = {
  job: Job | null;
  tokens: string;
  think: string;
  artifacts: Artifact[];
  trace?: TraceEvent[];
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
  kind: "inbox" | "custom" | "meeting" | "done" | string;
  source?: string | null;
  project_id?: string | null;
  project?: {
    id: string;
    name: string;
    title?: string;
    branch: string;
    synced_at?: string | null;
    sync_error?: string | null;
    repos?: { id: string; repository: string; label: string }[];
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
  recap?: string | null;
  artifact?: Artifact | null;
  virtual?: boolean;
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
