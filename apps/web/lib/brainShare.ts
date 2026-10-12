import { Agent, Job, LiveState, TraceEvent } from "./types";

export type CortexShare = {
  id: string;
  name: string;
  pigment: string;
  weight: number;
  live: boolean;
  caption: string;
  jobs: number;
};

function busyStatus(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

export function sharesFromFloor(
  agents: Agent[],
  jobs: Job[],
  live: Record<string, LiveState>,
  traces: Record<string, TraceEvent[]>,
  deskJobs?: Record<string, number>
): CortexShare[] {
  const weights = new Map<string, number>();
  for (const agent of agents) weights.set(agent.id, 1);
  for (const job of jobs) weights.set(job.agent_id, (weights.get(job.agent_id) || 0) + 3);
  if (deskJobs) {
    for (const [id, n] of Object.entries(deskJobs)) {
      weights.set(id, (weights.get(id) || 0) + Math.max(0, n) * 4);
    }
  }
  for (const agent of agents) {
    if (busyStatus(live[agent.id]?.job?.status)) {
      weights.set(agent.id, (weights.get(agent.id) || 0) + 14);
    }
  }
  const cutoff = Date.now() - 20_000;
  for (const [jobId, events] of Object.entries(traces)) {
    const agentId = jobs.find((row) => row.id === jobId)?.agent_id;
    if (!agentId) continue;
    for (const ev of events || []) {
      const name = String(ev.payload?.name || ev.label || "");
      if (name !== "repo_search" && name !== "repo_read" && name !== "recall") continue;
      const at = ev.at ? Date.parse(ev.at) : Date.now();
      if (!Number.isFinite(at) || at < cutoff) continue;
      weights.set(agentId, (weights.get(agentId) || 0) + 2);
    }
  }
  const jobCount = new Map<string, number>();
  for (const job of jobs) {
    jobCount.set(job.agent_id, (jobCount.get(job.agent_id) || 0) + 1);
  }
  return agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    pigment: agent.pigment || "#d46a3a",
    weight: Math.max(0.001, weights.get(agent.id) || 1),
    live: busyStatus(live[agent.id]?.job?.status),
    caption: (live[agent.id]?.job?.caption || live[agent.id]?.job?.activity || "").trim(),
    jobs: Math.max(jobCount.get(agent.id) || 0, deskJobs?.[agent.id] || 0),
  }));
}
