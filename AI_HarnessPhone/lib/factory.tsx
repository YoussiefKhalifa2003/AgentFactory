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
  apiFetch,
  apiUrl,
  sameOriginApi,
  saveConnection as persistConnection,
  savedToken,
  wsUrl,
} from "./config";
import {
  Agent,
  Artifact,
  Chain,
  Job,
  LiveState,
  PlantSnapshot,
  ShiftNote,
  TraceEvent,
} from "./types";
import { speak } from "./voice";

type Tab = "lists" | "floor" | "desk";

type AssignArgs = {
  itemId?: string;
  agentId?: string;
  text?: string;
  listId?: string;
  foreman?: boolean;
  files?: File[];
  chain?: { agent_id?: string; strength: string }[];
};

type FactoryValue = {
  agents: Agent[];
  jobs: Job[];
  live: Record<string, LiveState>;
  selectedId: string | null;
  connected: boolean;
  booted: boolean;
  offline: boolean;
  plant: PlantSnapshot | null;
  shift: ShiftNote | null;
  chains: Record<string, Chain>;
  tab: Tab;
  taskTick: number;
  netHint: "pc" | "phone" | null;
  apiBase: string;
  token: string;
  sameOrigin: boolean;
  select: (id: string | null) => void;
  setTab: (tab: Tab) => void;
  assignWork: (args: AssignArgs) => Promise<unknown>;
  cancelJob: (jobId: string) => Promise<void>;
  refresh: () => Promise<void>;
  saveConnection: (api: string, token: string) => void;
};

const Ctx = createContext<FactoryValue | null>(null);

function emptyLive(): LiveState {
  return { job: null, tokens: "", think: "", artifacts: [], trace: [] };
}

export function FactoryProvider({ children }: { children: React.ReactNode }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [live, setLive] = useState<Record<string, LiveState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [booted, setBooted] = useState(false);
  const [offline, setOffline] = useState(false);
  const [plant, setPlant] = useState<PlantSnapshot | null>(null);
  const [shift, setShift] = useState<ShiftNote | null>(null);
  const [chains, setChains] = useState<Record<string, Chain>>({});
  const [tab, setTab] = useState<Tab>("lists");
  const [taskTick, setTaskTick] = useState(0);
  const [netHint, setNetHint] = useState<"pc" | "phone" | null>(null);
  const [apiBase, setApiBase] = useState("");
  const [token, setToken] = useState("");
  const [sameOrigin, setSameOrigin] = useState(false);
  const [linkKey, setLinkKey] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const seenChains = useRef<Set<string>>(new Set());

  useEffect(() => {
    setApiBase(apiUrl());
    setToken(savedToken());
    setSameOrigin(sameOriginApi());
  }, [linkKey]);

  const refresh = useCallback(async () => {
    try {
      const [ar, jr, pr, sr] = await Promise.all([
        apiFetch("/api/agents"),
        apiFetch("/api/jobs"),
        apiFetch("/api/plant"),
        apiFetch("/api/shift/latest"),
      ]);
      if (!ar.ok || !jr.ok) throw new Error("api");
      setAgents(await ar.json());
      setJobs(await jr.json());
      if (pr.ok) setPlant(await pr.json());
      if (sr.ok) setShift(await sr.json());
      setOffline(false);
      setNetHint(null);
    } catch {
      setOffline(true);
      setNetHint(typeof navigator !== "undefined" && navigator.onLine === false ? "phone" : "pc");
    } finally {
      setBooted(true);
    }
  }, []);

  const loadChain = useCallback(async (chainId: string) => {
    if (!chainId || seenChains.current.has(chainId)) return;
    seenChains.current.add(chainId);
    try {
      const r = await apiFetch(`/api/chains/${chainId}`);
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
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    for (const job of jobs) {
      if (job.chain_id) loadChain(job.chain_id);
    }
  }, [jobs, loadChain]);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let raf = 0;
    const tokenBuf: Record<string, { text: string; think: string }> = {};
    const hint = () =>
      typeof navigator !== "undefined" && navigator.onLine === false ? "phone" : "pc";

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
      try {
        const ws = new WebSocket(wsUrl());
        wsRef.current = ws;
        ws.onopen = () => {
          setConnected(true);
          setNetHint(null);
          refresh().catch(() => undefined);
        };
        ws.onclose = () => {
          setConnected(false);
          if (!closed) {
            setNetHint(hint());
            timer = setTimeout(connect, 1500);
          }
        };
        ws.onerror = () => {
          setConnected(false);
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
            if (msg.plant && typeof msg.plant === "object") setPlant(msg.plant as PlantSnapshot);
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
            setSelectedId((cur) => (cur === gone ? null : cur));
          }
          if (msg.type === "task.updated") setTaskTick((n) => n + 1);
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
            setTaskTick((n) => n + 1);
            if (status === "done") {
              const out = String(msg.output || "");
              const prompt = String(msg.prompt || "");
              if (out && out !== "Done" && !/you are the critic/i.test(prompt)) speak(out);
            }
          }
          if (msg.type === "job.artifact" && msg.artifact && msg.jobId) {
            const art = msg.artifact as Artifact;
            setJobs((prev) =>
              prev.map((j) =>
                j.id === msg.jobId
                  ? { ...j, artifacts: [...(j.artifacts || []).filter((a) => a.id !== art.id), art] }
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
              const artifacts = [...cur.artifacts.filter((a) => a.id !== art.id && a.name !== art.name), art];
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
          } else if (msg.type === "job.trace" && msg.jobId) {
            const events = (msg.events || []) as TraceEvent[];
            const agentId = String(msg.agentId || "");
            setLive((prev) => {
              const cur = prev[agentId] || emptyLive();
              return { ...prev, [agentId]: { ...cur, trace: events } };
            });
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
                  ? [...cur.artifacts.filter((a) => a.id !== (msg.artifact as Artifact).id), msg.artifact as Artifact]
                  : cur.artifacts;
              return { ...prev, [agentId]: { job, tokens, think, artifacts } };
            });
          }
        };
      } catch {
        if (!closed) timer = setTimeout(connect, 1500);
      }
    };
    connect();
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      const sock = wsRef.current;
      if (!sock || sock.readyState === WebSocket.CLOSING || sock.readyState === WebSocket.CLOSED) {
        if (timer) clearTimeout(timer);
        connect();
      } else {
        refresh().catch(() => undefined);
      }
    };
    const onOffline = () => {
      setConnected(false);
      setNetHint("phone");
    };
    const onOnline = () => {
      setNetHint(null);
      if (timer) clearTimeout(timer);
      connect();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      if (raf) cancelAnimationFrame(raf);
      wsRef.current?.close();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [refresh, linkKey]);

  const assignWork = useCallback(async (args: AssignArgs) => {
    if (args.agentId) {
      setSelectedId(args.agentId);
      setTab("desk");
    }
    let r: Response;
    if (args.files && args.files.length) {
      const form = new FormData();
      if (args.itemId) form.append("item_id", args.itemId);
      if (args.agentId) form.append("agent_id", args.agentId);
      if (args.text) form.append("text", args.text);
      if (args.listId) form.append("list_id", args.listId);
      if (args.foreman) form.append("foreman", "true");
      if (args.chain) form.append("chain", JSON.stringify(args.chain));
      for (const file of args.files) form.append("files", file);
      r = await apiFetch("/api/assign", { method: "POST", body: form });
    } else {
      r = await apiFetch("/api/assign", {
        method: "POST",
        body: JSON.stringify({
          item_id: args.itemId || null,
          agent_id: args.agentId || null,
          text: args.text || null,
          list_id: args.listId || null,
          foreman: args.foreman || false,
          chain: args.chain || null,
        }),
      });
    }
    if (!r.ok) throw new Error((await r.text()) || "Could not assign");
    const data = await r.json();
    const nextAgent =
      (data.agent?.id as string | undefined) ||
      args.agentId ||
      (Array.isArray(args.chain) ? args.chain[0]?.agent_id : undefined);
    if (nextAgent) {
      setSelectedId(nextAgent);
      setTab("desk");
    }
    if (data.job && nextAgent) {
      setJobs((prev) => [data.job, ...prev.filter((x: Job) => x.id !== data.job.id)]);
      setLive((prev) => ({
        ...prev,
        [nextAgent]: { job: data.job, tokens: "", think: "", artifacts: [] },
      }));
    }
    setTaskTick((n) => n + 1);
    return data;
  }, []);

  const cancelJob = useCallback(async (jobId: string) => {
    await apiFetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
  }, []);

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) setTab("desk");
  }, []);

  const saveConnection = useCallback((api: string, nextToken: string) => {
    persistConnection(api, nextToken);
    setLinkKey((n) => n + 1);
  }, []);

  const value = useMemo(
    () => ({
      agents,
      jobs,
      live,
      selectedId,
      connected,
      booted,
      offline,
      plant,
      shift,
      chains,
      tab,
      taskTick,
      netHint,
      apiBase,
      token,
      sameOrigin,
      select,
      setTab,
      assignWork,
      cancelJob,
      refresh,
      saveConnection,
    }),
    [
      agents,
      jobs,
      live,
      selectedId,
      connected,
      booted,
      offline,
      plant,
      shift,
      chains,
      tab,
      taskTick,
      netHint,
      apiBase,
      token,
      sameOrigin,
      select,
      assignWork,
      cancelJob,
      refresh,
      saveConnection,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFactory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("factory");
  return ctx;
}

export { apiUrl };
