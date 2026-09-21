"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  API_URL,
  Artifact,
  Agent,
  Job,
  LiveState,
  WS_URL,
} from "./types";

type AssignArgs = {
  itemId?: string;
  agentId?: string;
  text?: string;
  listId?: string;
};

type FactoryContextValue = {
  agents: Agent[];
  jobs: Job[];
  live: Record<string, LiveState>;
  selectedId: string | null;
  stageOpen: boolean;
  connected: boolean;
  taskTick: number;
  select: (id: string | null) => void;
  openStage: (id: string) => void;
  closeStage: () => void;
  toggleStage: (id?: string) => void;
  submitJob: (agentId: string, prompt: string) => void;
  assignWork: (args: AssignArgs) => Promise<{ queued?: boolean } | void>;
  deleteAgent: (agentId: string) => Promise<void>;
  updateAgent: (agentId: string, payload: Partial<Agent>) => Promise<Agent>;
  refresh: () => Promise<void>;
  setAgents: (agents: Agent[]) => void;
};

const FactoryContext = createContext<FactoryContextValue | null>(null);

function emptyLive(): LiveState {
  return { job: null, tokens: "", think: "", artifacts: [] };
}

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageOpen, setStageOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const [taskTick, setTaskTick] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    const [a, j] = await Promise.all([
      fetch(`${API_URL}/api/agents`).then((r) => r.json()),
      fetch(`${API_URL}/api/jobs`).then((r) => r.json()),
    ]);
    setAgents(a);
    setJobs(j);
  }, []);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (!jobs.length) return;
    setLive((prev) => {
      const latest: Record<string, Job> = {};
      for (const job of jobs) {
        const blob = `${job.caption || ""} ${job.error || ""} ${job.output || ""}`;
        const junk =
          !job.output?.trim() &&
          /server restarted|interrupted|freetiererror|creditserror|payment method|opencode\.ai\/workspace/i.test(
            blob
          );
        if (junk) continue;
        if (!latest[job.agent_id]) latest[job.agent_id] = job;
      }
      let changed = false;
      const next = { ...prev };
      for (const [id, job] of Object.entries(latest)) {
        if (next[id]?.job) continue;
        next[id] = {
          job,
          tokens: job.output || "",
          think: "",
          artifacts: next[id]?.artifacts || [],
        };
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [jobs]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("select");
    if (!wanted) return;
    setSelectedId(wanted);
    params.delete("select");
    const query = params.toString();
    window.history.replaceState({}, "", query ? `/?${query}` : "/");
  }, []);

  useEffect(() => {
    if (!agents.length) return;
    if (!selectedId || !agents.some((a) => a.id === selectedId)) {
      setSelectedId(agents[0].id);
    }
  }, [agents, selectedId]);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tokenBuf: Record<string, { text: string; think: string }> = {};
    let raf = 0;

    const flushTokens = () => {
      raf = 0;
      const ids = Object.keys(tokenBuf);
      if (!ids.length) return;
      const snapshot = { ...tokenBuf };
      for (const id of ids) delete tokenBuf[id];
      setLive((prev) => {
        const next = { ...prev };
        for (const id of ids) {
          const add = snapshot[id];
          const cur = next[id] || emptyLive();
          next[id] = {
            ...cur,
            tokens: (cur.tokens || "") + add.text,
            think: (cur.think || "") + add.think,
          };
        }
        return next;
      });
    };

    const connect = () => {
      if (closed) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "hello" && msg.agents) {
          setAgents(msg.agents);
        }
        if (msg.type === "agent.updated" && msg.agent) {
          const next = msg.agent as Agent;
          setAgents((prev) => prev.map((a) => (a.id === next.id ? next : a)));
        }
        if (msg.type === "agent.deleted" && msg.agentId) {
          const gone = msg.agentId as string;
          setAgents((prev) => prev.filter((a) => a.id !== gone));
          setLive((prev) => {
            const next = { ...prev };
            delete next[gone];
            return next;
          });
          setSelectedId((cur) => {
            if (cur === gone) {
              setStageOpen(false);
              return null;
            }
            return cur;
          });
        }
        if (msg.type === "task.updated") {
          setTaskTick((n) => n + 1);
        }
        if (msg.type === "job.queued" && msg.job) {
          const job = msg.job as Job;
          setJobs((prev) => [job, ...prev.filter((x) => x.id !== job.id)]);
          setLive((prev) => ({
            ...prev,
            [job.agent_id]: { job, tokens: "", think: "", artifacts: [] },
          }));
        }
        if (msg.type === "job.done" || msg.type === "job.blocked") {
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
          if (msg.agentId) delete tokenBuf[msg.agentId];
          setJobs((prev) =>
            prev.map((j) =>
              j.id === msg.jobId
                ? {
                    ...j,
                    status: msg.type === "job.done" ? "done" : "blocked",
                    activity: msg.activity || j.activity,
                    caption: msg.caption || j.caption,
                    output: msg.output ?? j.output,
                    error: msg.error ?? j.error,
                  }
                : j
            )
          );
        }
        if (msg.type === "job.artifact" && msg.artifact && msg.jobId) {
          const art = msg.artifact as Artifact;
          setJobs((prev) =>
            prev.map((j) =>
              j.id === msg.jobId
                ? {
                    ...j,
                    artifacts: [...(j.artifacts || []).filter((a) => a.id !== art.id), art],
                  }
                : j
            )
          );
        }
        if (msg.type === "job.token" && msg.agentId) {
          const slot = (tokenBuf[msg.agentId] ||= { text: "", think: "" });
          if (msg.channel === "think") slot.think += msg.delta || "";
          else slot.text += msg.delta || "";
          if (!raf) raf = requestAnimationFrame(flushTokens);
        }
        if (msg.jobId && msg.agentId && msg.type !== "job.token") {
          setLive((prev) => {
            const cur = prev[msg.agentId] || emptyLive();
            const job = {
              ...(cur.job || {
                id: msg.jobId,
                agent_id: msg.agentId,
                prompt: "",
                status: "thinking",
                activity: "thinking",
                caption: "",
                output: "",
                error: null,
              }),
              activity: msg.activity || cur.job?.activity || "thinking",
              caption: msg.caption || cur.job?.caption || "",
              status:
                msg.type === "job.done"
                  ? "done"
                  : msg.type === "job.blocked"
                    ? "blocked"
                    : cur.job?.status || "thinking",
              output: msg.output ?? cur.job?.output ?? "",
              error: msg.error ?? cur.job?.error ?? null,
              id: msg.jobId,
              agent_id: msg.agentId,
            };
            let tokens = cur.tokens;
            let think = cur.think || "";
            if (msg.type === "job.started") {
              tokens = "";
              think = "";
              delete tokenBuf[msg.agentId];
            }
            if (msg.type === "job.done") {
              tokens = msg.output || tokens;
              think = "";
            }
            const artifacts =
              msg.type === "job.artifact" && msg.artifact
                ? [
                    ...cur.artifacts.filter((a) => a.id !== msg.artifact.id),
                    msg.artifact as Artifact,
                  ]
                : cur.artifacts;
            return { ...prev, [msg.agentId]: { job, tokens, think, artifacts } };
          });
        }
      };
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      wsRef.current?.close();
    };
  }, []);

  const deleteAgent = useCallback(async (agentId: string) => {
    const r = await fetch(`${API_URL}/api/agents/${agentId}`, { method: "DELETE" });
    if (!r.ok) {
      throw new Error((await r.text()) || "Could not delete agent");
    }
    setAgents((prev) => prev.filter((a) => a.id !== agentId));
    setLive((prev) => {
      const next = { ...prev };
      delete next[agentId];
      return next;
    });
    setSelectedId((cur) => {
      if (cur === agentId) setStageOpen(false);
      return cur === agentId ? null : cur;
    });
  }, []);

  const updateAgent = useCallback(async (agentId: string, payload: Partial<Agent>) => {
    const r = await fetch(`${API_URL}/api/agents/${agentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      throw new Error((await r.text()) || "Could not update agent");
    }
    const updated = (await r.json()) as Agent;
    setAgents((prev) => prev.map((a) => (a.id === agentId ? updated : a)));
    return updated;
  }, []);

  const assignWork = useCallback(async (args: AssignArgs) => {
    const agentId = args.agentId;
    if (agentId) setSelectedId(agentId);
    const r = await fetch(`${API_URL}/api/assign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        item_id: args.itemId || null,
        agent_id: args.agentId || null,
        text: args.text || null,
        list_id: args.listId || null,
      }),
    });
    if (!r.ok) {
      throw new Error((await r.text()) || "Could not assign");
    }
    const data = await r.json();
    const nextAgent = (data.agent?.id as string | undefined) || agentId;
    if (nextAgent) setSelectedId(nextAgent);
    if (data.job && nextAgent) {
      setJobs((prev) => [data.job, ...prev.filter((x) => x.id !== data.job.id)]);
      setLive((prev) => ({
        ...prev,
        [nextAgent]: {
          job: data.job,
          tokens: "",
          think: "",
          artifacts: [],
        },
      }));
    }
    setTaskTick((n) => n + 1);
    return data;
  }, []);

  const submitJob = useCallback(
    (agentId: string, prompt: string) => {
      assignWork({ agentId, text: prompt, listId: "inbox" }).catch(() => undefined);
    },
    [assignWork]
  );

  const value = useMemo<FactoryContextValue>(
    () => ({
      agents,
      jobs,
      live,
      selectedId,
      stageOpen,
      connected,
      taskTick,
      select: setSelectedId,
      openStage: (id: string) => {
        setSelectedId(id);
        setStageOpen(true);
      },
      closeStage: () => setStageOpen(false),
      toggleStage: (id?: string) => {
        const target = id || selectedId;
        if (!target) return;
        setSelectedId(target);
        setStageOpen((open) => (id && id !== selectedId ? true : !open));
      },
      submitJob,
      assignWork,
      deleteAgent,
      updateAgent,
      refresh,
      setAgents,
    }),
    [
      agents,
      jobs,
      live,
      selectedId,
      stageOpen,
      connected,
      taskTick,
      submitJob,
      assignWork,
      deleteAgent,
      updateAgent,
      refresh,
    ]
  );

  return (
    <FactoryContext.Provider value={value}>{children}</FactoryContext.Provider>
  );
}

export function useFactory() {
  const ctx = useContext(FactoryContext);
  if (!ctx) throw new Error("useFactory outside provider");
  return ctx;
}
