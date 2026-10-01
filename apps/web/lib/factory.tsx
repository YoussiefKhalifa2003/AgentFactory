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
  Chain,
  Job,
  LiveState,
  PinCard,
  PlantSnapshot,
  SceneQuality,
  ShiftNote,
  TraceEvent,
  WS_URL,
} from "./types";

type AssignArgs = {
  itemId?: string;
  agentId?: string;
  text?: string;
  listId?: string;
  foreman?: boolean;
  chain?: { agent_id?: string; strength: string; prompt?: string; depends_on?: number | null; inherit?: boolean }[];
};

function busyStatus(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

function settledStatus(status?: string) {
  return ["done", "blocked", "cancelled"].includes(status || "");
}

export type StageMode = "office" | "desk" | null;

type FactoryContextValue = {
  agents: Agent[];
  jobs: Job[];
  live: Record<string, LiveState>;
  selectedId: string | null;
  stageOpen: boolean;
  stageMode: StageMode;
  connected: boolean;
  booted: boolean;
  offline: boolean;
  taskTick: number;
  openListId: string;
  plant: PlantSnapshot | null;
  chains: Record<string, Chain>;
  showroom: PinCard[];
  shift: ShiftNote | null;
  preview: { jobId: string; file: Artifact } | null;
  traces: Record<string, TraceEvent[]>;
  quality: SceneQuality;
  paletteOpen: boolean;
  insightsOpen: boolean;
  galleryOpen: boolean;
  setOpenListId: (id: string) => void;
  select: (id: string | null) => void;
  openStage: (id: string) => void;
  openOffice: () => void;
  openDesk: (id?: string) => void;
  closeStage: () => void;
  toggleStage: (id?: string) => void;
  openPreview: (jobId: string, file: Artifact) => void;
  closePreview: () => void;
  setQuality: (q: SceneQuality) => void;
  setPaletteOpen: (open: boolean) => void;
  setInsightsOpen: (open: boolean) => void;
  setGalleryOpen: (open: boolean) => void;
  submitJob: (agentId: string, prompt: string) => void;
  assignWork: (args: AssignArgs) => Promise<{ queued?: boolean; agent?: Agent; job?: Job } | void>;
  deleteAgent: (agentId: string) => Promise<void>;
  updateAgent: (agentId: string, payload: Partial<Agent>) => Promise<Agent>;
  refresh: () => Promise<void>;
  refreshShowroom: () => Promise<void>;
  setAgents: (agents: Agent[]) => void;
};

const FactoryContext = createContext<FactoryContextValue | null>(null);

function emptyLive(): LiveState {
  return { job: null, tokens: "", think: "", artifacts: [], trace: [] };
}

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stageMode, setStageMode] = useState<StageMode>(null);
  const stageOpen = stageMode !== null;
  const [connected, setConnected] = useState(false);
  const [booted, setBooted] = useState(false);
  const [offline, setOffline] = useState(false);
  const [taskTick, setTaskTick] = useState(0);
  const [openListId, setOpenListId] = useState("inbox");
  const [plant, setPlant] = useState<PlantSnapshot | null>(null);
  const [chains, setChains] = useState<Record<string, Chain>>({});
  const [showroom, setShowroom] = useState<PinCard[]>([]);
  const [shift, setShift] = useState<ShiftNote | null>(null);
  const [preview, setPreview] = useState<{ jobId: string; file: Artifact } | null>(null);
  const [traces, setTraces] = useState<Record<string, TraceEvent[]>>({});
  const [quality, setQuality] = useState<SceneQuality>("high");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const seenChains = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const [ar, jr] = await Promise.all([
        fetch(`${API_URL}/api/agents`),
        fetch(`${API_URL}/api/jobs`),
      ]);
      if (!ar.ok || !jr.ok) throw new Error("api");
      setAgents(await ar.json());
      setJobs(await jr.json());
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setBooted(true);
    }
  }, []);

  const refreshShowroom = useCallback(async () => {
    try {
      const r = await fetch(`${API_URL}/api/showroom`);
      if (!r.ok) return;
      const data = await r.json();
      setShowroom(Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : []);
    } catch {
      /* showroom lands in Wave B */
    }
  }, []);

  const loadChain = useCallback(async (chainId: string) => {
    if (!chainId || seenChains.current.has(chainId)) return;
    seenChains.current.add(chainId);
    try {
      const r = await fetch(`${API_URL}/api/chains/${chainId}`);
      if (!r.ok) {
        seenChains.current.delete(chainId);
        return;
      }
      const chain = (await r.json()) as Chain;
      setChains((prev) => ({ ...prev, [chain.id]: chain }));
    } catch {
      seenChains.current.delete(chainId);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem("foundry.quality") as SceneQuality | null;
    if (saved === "high" || saved === "medium" || saved === "low" || saved === "off") {
      setQuality(saved);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("foundry.quality", quality);
  }, [quality]);

  useEffect(() => {
    refresh().catch(() => undefined);
    refreshShowroom().catch(() => undefined);
  }, [refresh, refreshShowroom]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`${API_URL}/api/plant`);
        if (!r.ok || stop) return;
        setPlant(await r.json());
      } catch {
        /* plant is optional until the API is up */
      }
    };
    tick();
    const timer = window.setInterval(tick, 4000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    for (const job of jobs) {
      if (job.chain_id) loadChain(job.chain_id);
    }
  }, [jobs, loadChain]);

  useEffect(() => {
    if (!jobs.length) return;
    setLive((prev) => {
      const byId = new Map(jobs.map((job) => [job.id, job]));
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
      for (const [agentId, slot] of Object.entries(next)) {
        const liveJob = slot.job;
        if (!liveJob?.id) continue;
        const server = byId.get(liveJob.id);
        if (!server) continue;
        if (server && settledStatus(server.status) && liveJob.status !== server.status) {
          next[agentId] = {
            ...slot,
            job: { ...liveJob, ...server },
            tokens:
              String(server.output || "").length >= String(slot.tokens || "").length
                ? server.output || slot.tokens
                : slot.tokens,
            think: server.status === "done" ? "" : slot.think,
          };
          changed = true;
        }
      }
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
      ws.onopen = () => {
        setConnected(true);
        refresh().catch(() => undefined);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        let msg: { type?: string; [key: string]: unknown };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "hello") {
          if (Array.isArray(msg.agents)) setAgents(msg.agents as Agent[]);
          const incoming = (Array.isArray(msg.jobs) ? msg.jobs : []) as Job[];
          if (incoming.length) {
            setJobs((prev) => {
              const map = new Map(prev.map((job) => [job.id, job]));
              for (const job of incoming) map.set(job.id, { ...map.get(job.id), ...job });
              return [...map.values()];
            });
          }
          if (msg.plant && typeof msg.plant === "object") {
            setPlant(msg.plant as PlantSnapshot);
          }
          setLive((prev) => {
            if (!incoming.length) return prev;
            const next = { ...prev };
            for (const job of incoming) {
              const cur = next[job.agent_id];
              const kept = cur?.job?.id === job.id ? cur.tokens || "" : "";
              next[job.agent_id] = {
                job,
                tokens: kept.length >= (job.output || "").length ? kept : job.output || "",
                think: cur?.think || "",
                artifacts: cur?.artifacts?.length ? cur.artifacts : job.artifacts || [],
              };
            }
            return next;
          });
          refresh().catch(() => undefined);
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
              setStageMode(null);
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
        if (msg.type === "job.done" || msg.type === "job.blocked" || msg.type === "job.cancelled") {
          if (raf) {
            cancelAnimationFrame(raf);
            raf = 0;
          }
          if (msg.agentId) delete tokenBuf[String(msg.agentId)];
          const status =
            msg.type === "job.done" ? "done" : msg.type === "job.cancelled" ? "cancelled" : "blocked";
          setJobs((prev) =>
            prev.map((j) =>
              j.id === msg.jobId
                ? {
                    ...j,
                    status,
                    activity: (msg.activity as string) || j.activity,
                    caption: (msg.caption as string) || j.caption,
                    output:
                      String(msg.output || "").length >= (j.output || "").length
                        ? ((msg.output as string) ?? j.output)
                        : j.output,
                    error: (msg.error as string) ?? j.error,
                  }
                : j
            )
          );
          if (status === "done") refreshShowroom().catch(() => undefined);
          setTaskTick((n) => n + 1);
          if (status === "done" || status === "blocked") {
            const name = String(msg.agentName || msg.caption || "Desk");
            const title = status === "done" ? "Job finished" : "Needs attention";
            document.title = status === "done" ? "Done · Workspace" : "Attention · Workspace";
            try {
              import("sonner").then(({ toast }) => {
                toast(title, { description: name });
              });
            } catch {
              /* toast optional */
            }
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(title, { body: String(msg.caption || name) });
            }
          }
        }
        if (msg.type === "job.trace" && msg.jobId) {
          const jobId = String(msg.jobId);
          const events = (Array.isArray(msg.events) ? msg.events : []) as TraceEvent[];
          setTraces((prev) => ({ ...prev, [jobId]: events }));
          if (msg.agentId) {
            const agentId = String(msg.agentId);
            setLive((prev) => {
              const cur = prev[agentId] || emptyLive();
              return { ...prev, [agentId]: { ...cur, trace: events } };
            });
          }
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
          const agentId = String(msg.agentId);
          const slot = (tokenBuf[agentId] ||= { text: "", think: "" });
          if (msg.channel === "think") slot.think += String(msg.delta || "");
          else slot.text += String(msg.delta || "");
          if (!raf) raf = requestAnimationFrame(flushTokens);
        }
        if (msg.type === "job.file" && msg.artifact && msg.agentId) {
          const art = msg.artifact as Artifact;
          const agentId = String(msg.agentId);
          const jobId = String(msg.jobId || "");
          setLive((prev) => {
            const cur = prev[agentId] || emptyLive();
            const artifacts = [
              ...cur.artifacts.filter((a) => a.id !== art.id && a.name !== art.name),
              art,
            ];
            return { ...prev, [agentId]: { ...cur, artifacts } };
          });
          if (jobId) {
            setJobs((prev) =>
              prev.map((j) =>
                j.id === jobId
                  ? {
                      ...j,
                      artifacts: [...(j.artifacts || []).filter((a) => a.id !== art.id && a.name !== art.name), art],
                    }
                  : j
              )
            );
          }
        } else if (msg.type === "plant" && msg.plant && typeof msg.plant === "object") {
          setPlant(msg.plant as PlantSnapshot);
        } else if (msg.type === "chain.updated" && msg.chain) {
          const chain = msg.chain as Chain;
          seenChains.current.add(chain.id);
          setChains((prev) => ({ ...prev, [chain.id]: chain }));
        } else if (msg.type === "shift.updated" && msg.shift) {
          setShift(msg.shift as ShiftNote);
        } else if (msg.jobId && msg.agentId && msg.type !== "job.token") {
          const agentId = String(msg.agentId);
          const jobId = String(msg.jobId);
          setLive((prev) => {
            const cur = prev[agentId] || emptyLive();
            const job = {
              ...(cur.job || {
                id: jobId,
                agent_id: agentId,
                prompt: "",
                status: "thinking",
                activity: "thinking",
                caption: "",
                output: "",
                error: null,
              }),
              activity: (msg.activity as string) || cur.job?.activity || "thinking",
              caption: (msg.caption as string) || cur.job?.caption || "",
              status:
                msg.type === "job.done"
                  ? "done"
                  : msg.type === "job.blocked"
                    ? "blocked"
                    : msg.type === "job.cancelled"
                      ? "cancelled"
                      : cur.job?.status || "thinking",
              output: (msg.output as string) ?? cur.job?.output ?? "",
              error: (msg.error as string) ?? cur.job?.error ?? null,
              id: jobId,
              agent_id: agentId,
              chain_id: (msg.chain_id as string) || cur.job?.chain_id || null,
              chain_step_id: (msg.chain_step_id as string) || cur.job?.chain_step_id || null,
            };
            let tokens = cur.tokens;
            let think = cur.think || "";
            if (msg.type === "job.started") {
              tokens = "";
              think = "";
              delete tokenBuf[agentId];
            }
            if (msg.type === "job.done" || msg.type === "job.blocked") {
              const incoming = String(msg.output || "");
              tokens = incoming.length >= tokens.length ? incoming || tokens : tokens;
              if (msg.type === "job.done") think = "";
            }
            const artifacts =
              msg.type === "job.artifact" && msg.artifact
                ? [
                    ...cur.artifacts.filter((a) => a.id !== (msg.artifact as Artifact).id),
                    msg.artifact as Artifact,
                  ]
                : cur.artifacts;
            return { ...prev, [agentId]: { job, tokens, think, artifacts } };
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
  }, [refresh, refreshShowroom]);

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
      if (cur === agentId) setStageMode(null);
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
        foreman: args.foreman || false,
        chain: args.chain || null,
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
      stageMode,
      connected,
      booted,
      offline,
      taskTick,
      openListId,
      plant,
      chains,
      showroom,
      shift,
      preview,
      traces,
      quality,
      paletteOpen,
      insightsOpen,
      galleryOpen,
      setOpenListId,
      select: setSelectedId,
      openStage: (id: string) => {
        setSelectedId(id);
        setStageMode("desk");
      },
      openOffice: () => setStageMode("office"),
      openDesk: (id?: string) => {
        if (id) setSelectedId(id);
        setStageMode("desk");
      },
      closeStage: () => setStageMode(null),
      toggleStage: (id?: string) => {
        if (id) {
          setSelectedId(id);
          setStageMode((mode) => (mode === "desk" && id === selectedId ? null : "desk"));
          return;
        }
        setStageMode((mode) => (mode === "office" ? null : "office"));
      },
      openPreview: (jobId: string, file: Artifact) => setPreview({ jobId, file }),
      closePreview: () => setPreview(null),
      setQuality,
      setPaletteOpen,
      setInsightsOpen,
      setGalleryOpen,
      submitJob,
      assignWork,
      deleteAgent,
      updateAgent,
      refresh,
      refreshShowroom,
      setAgents,
    }),
    [
      agents,
      jobs,
      live,
      selectedId,
      stageOpen,
      stageMode,
      connected,
      booted,
      offline,
      taskTick,
      openListId,
      plant,
      chains,
      showroom,
      shift,
      preview,
      traces,
      quality,
      paletteOpen,
      insightsOpen,
      galleryOpen,
      submitJob,
      assignWork,
      deleteAgent,
      updateAgent,
      refresh,
      refreshShowroom,
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
