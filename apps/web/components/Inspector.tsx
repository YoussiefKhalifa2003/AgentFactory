"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFactory } from "@/lib/factory";
import { API_URL, Artifact, Job, ListItem, STRENGTHS } from "@/lib/types";
import { splitPacks, useSkillCatalog } from "@/lib/skills";
import { taskTitle } from "@/lib/tasks";
import { RichText } from "@/lib/rich-text";
import { ModelPicker } from "./ModelPicker";
import { portraitFor, randomLook } from "@/lib/look";
import { Chip } from "./ui/Chip";
import { SegmentedControl } from "./ui/SegmentedControl";
import { WorkTrace } from "./WorkTrace";
import { Modal } from "./ui/Modal";

function isNoise(job: Job) {
  if (job.status === "queued" || job.status === "thinking" || job.status === "tool") return false;
  const blob = `${job.caption || ""} ${job.error || ""} ${job.output || ""}`;
  if (/server restarted|interrupted/i.test(blob) && !job.output?.trim()) return true;
  if (
    /freetiererror|creditserror|payment method|opencode\.ai\/workspace|only be used from within opencode/i.test(
      blob
    ) &&
    !job.output?.trim()
  ) {
    return true;
  }
  return false;
}

function stripThink(text: string, live = false) {
  let out = text || "";
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (live) {
    out = out.replace(/<\/?think>/gi, "");
  } else {
    out = out.replace(/<think>[\s\S]*$/gi, "");
  }
  return out.trim();
}

function friendlyText(text: string, live = false) {
  const raw = stripThink(text, live).trim();
  if (!raw) return "";
  if (/freetiererror|only be used from within opencode/i.test(raw)) {
    return "That OpenCode free model isn’t available here. Pick OpenRouter, Spark, or a local model.";
  }
  if (/creditserror|payment method|opencode\.ai\/workspace/i.test(raw)) {
    return "OpenCode ran out of credit. Switch this bay to OpenRouter, Spark, or a local model.";
  }
  if (/spark_api_key is missing|no api key passed in/i.test(raw)) {
    return "Spark needs SPARK_API_KEY in apps/api/.env.";
  }
  if (/server restarted|interrupted/i.test(raw)) {
    return "Interrupted — assign it again.";
  }
  if (/can't find closing|looks like object|couldn't complete this job/i.test(raw)) {
    return "";
  }
  return raw
    .replace(/\{"type":"error"[^\n]*/g, "")
    .replace(/https:\/\/opencode\.ai\/workspace\/\S+/g, "")
    .trim();
}

function clip(text: string, limit = 640) {
  const t = text.trim();
  if (t.length <= limit) return t;
  return `${t.slice(0, limit).trim()}\n…`;
}

function collapseRepeats(text: string) {
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of paras) {
    const key = p.replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  const lines: string[] = [];
  let last = "";
  for (const line of out.join("\n\n").split("\n")) {
    if (line === last) continue;
    lines.push(line);
    last = line;
  }
  return lines.join("\n").trim();
}

function jobReply(
  job: Job,
  liveTokens: string,
  liveThink: string,
  liveJobId: string | undefined,
  working: boolean
) {
  const live =
    working && liveJobId && job.id === liveJobId ? liveTokens || liveThink : "";
  if (live) return friendlyText(live, true);
  const text = collapseRepeats(friendlyText(job.output || ""));
  if (text) return text;
  if (job.status === "blocked") return job.error || "Couldn't finish that job.";
  if (job.status === "done") return "Done.";
  return "";
}

function filesForJob(job: Job, liveArts: Artifact[], liveJobId?: string) {
  const map = new Map<string, Artifact>();
  for (const a of job.artifacts || []) map.set(a.id, a);
  if (job.id === liveJobId) {
    for (const a of liveArts) map.set(a.id, a);
  }
  return [...map.values()];
}

function isHtmlFile(a: Artifact) {
  return a.kind === "site" || /\.html?$/i.test(a.name);
}

function isImageFile(a: Artifact) {
  return a.kind === "plot" || /\.(png|jpe?g|gif|svg|webp)$/i.test(a.name);
}

function isDrawioFile(a: Artifact) {
  return /\.drawio$/i.test(a.name);
}

function isMermaidFile(a: Artifact) {
  return /\.mmd$/i.test(a.name);
}

function isSheetFile(a: Artifact) {
  return a.kind === "sheet" || /\.csv$/i.test(a.name);
}

function isPdfFile(a: Artifact) {
  return a.kind === "pack" || /\.pdf$/i.test(a.name);
}

function writableListId(id: string | null | undefined) {
  if (!id || id === "done") return "inbox";
  return id;
}

function fileKindLabel(file: Artifact) {
  if (/slides\.html$/i.test(file.name)) return "Deck";
  if (isHtmlFile(file)) return "Page";
  if (isMermaidFile(file)) return "Chart";
  if (isDrawioFile(file)) return "draw.io";
  if (isSheetFile(file)) return "Sheet";
  if (isPdfFile(file)) return "PDF";
  if (/\.md$/i.test(file.name) || file.kind === "report") return "Notes";
  if (isImageFile(file)) return "Image";
  return file.name;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = (text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function SheetTable({ source }: { source: string }) {
  const rows = parseCsv(source);
  if (!rows.length) {
    return <p className="p-4 text-sm text-[var(--ink-soft)]">Empty sheet.</p>;
  }
  const [head, ...body] = rows;
  return (
    <div className="sheet-wrap max-h-[70vh]">
      <table className="sheet-table">
        <thead>
          <tr>
            {head.map((cell, i) => (
              <th key={i}>{cell || " "}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i}>
              {head.map((_, j) => (
                <td key={j}>{r[j] || ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function mermaidSource(raw: string) {
  const text = (raw || "").trim();
  const fence = text.match(/^```(?:mermaid|mmd)?\s*\n([\s\S]*?)```$/i);
  return (fence ? fence[1] : text).trim();
}

function MermaidChart({ source }: { source: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const src = mermaidSource(source);

  useEffect(() => {
    let stop = false;
    setSvg(null);
    setError(false);
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          fontFamily: "Georgia, serif",
          themeVariables: {
            background: "#ffffff",
            primaryColor: "#fff7ee",
            primaryTextColor: "#1c1814",
            primaryBorderColor: "#1c1814",
            lineColor: "#1c1814",
            secondaryColor: "#e7dfd1",
            tertiaryColor: "#f3eee4",
            nodeBorder: "#1c1814",
            mainBkg: "#fff7ee",
            clusterBkg: "#f3eee4",
            titleColor: "#1c1814",
            edgeLabelBackground: "#fff7ee",
          },
        });
        const id = `chart-${Math.random().toString(36).slice(2, 10)}`;
        const drawn = await mermaid.render(id, src);
        if (!stop) setSvg(drawn.svg);
      } catch {
        if (!stop) setError(true);
      }
    })();
    return () => {
      stop = true;
    };
  }, [src]);

  if (error) {
    return (
      <pre className="max-h-[70vh] overflow-auto p-4 text-sm whitespace-pre-wrap">{src}</pre>
    );
  }
  if (!svg) {
    return <p className="p-4 text-sm text-[var(--ink-soft)]">Drawing chart…</p>;
  }
  return (
    <div className="mermaid-view max-h-[70vh]" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}

const DRAWIO_ORIGIN = "https://embed.diagrams.net";
const DRAWIO_EMBED =
  "https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=0&ui=min&saveAndExit=0&noSaveBtn=1&noExitBtn=1";

function DrawioEmbed({ xml }: { xml: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = useState("");

  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.origin !== DRAWIO_ORIGIN) return;
      let msg: { event?: string } = {};
      try {
        msg = typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      } catch {
        return;
      }
      if (msg.event !== "init") return;
      frame.current?.contentWindow?.postMessage(
        JSON.stringify({ action: "load", xml, autosave: 0 }),
        DRAWIO_ORIGIN
      );
    }
    window.addEventListener("message", onMessage);
    setSrc(DRAWIO_EMBED);
    return () => {
      window.removeEventListener("message", onMessage);
      setSrc("");
    };
  }, [xml]);

  return (
    <iframe
      ref={frame}
      title="draw.io"
      src={src}
      className="h-full w-full border-0"
    />
  );
}

function previewSrc(jobId: string, file: Artifact) {
  const stamp = file.created_at || file.id;
  if (isHtmlFile(file)) {
    const rel = file.name.replace(/^\/+/, "") || "index.html";
    return `${API_URL}/api/jobs/${jobId}/site/${rel}?v=${encodeURIComponent(stamp)}`;
  }
  return `${API_URL}/api/artifacts/${file.id}/file?v=${encodeURIComponent(stamp)}`;
}

function downloadSrc(file: Artifact) {
  return `${API_URL}/api/artifacts/${file.id}/file?download=1`;
}

export function FilePreview({
  jobId,
  file,
  onClose,
}: {
  jobId: string;
  file: Artifact;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [src, setSrc] = useState(previewSrc(jobId, file));
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = isHtmlFile(file);
  const image = isImageFile(file);
  const drawio = isDrawioFile(file);
  const mermaid = isMermaidFile(file);
  const sheet = isSheetFile(file);
  const pdf = isPdfFile(file);
  const pageUrl = html ? src : "";

  useEffect(() => {
    const next = previewSrc(jobId, file);
    const timer = window.setTimeout(() => setSrc(next), 800);
    return () => window.clearTimeout(timer);
  }, [jobId, file.id, file.created_at, file.name, file.kind]);

  useEffect(() => {
    if (html || image || pdf) return;
    let stop = false;
    fetch(`${API_URL}/api/artifacts/${file.id}/file`)
      .then((r) => r.text())
      .then((body) => {
        if (!stop) setText(body);
      })
      .catch(() => {
        if (!stop) setText("Couldn't load this file.");
      });
    return () => {
      stop = true;
    };
  }, [file.id, html, image, pdf]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-[rgba(28,24,20,0.32)] p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="flex h-[min(92vh,1080px)] w-[min(94vw,1400px)] flex-col overflow-hidden rounded-[28px] bg-[#fffdf8] shadow-[0_40px_80px_-32px_rgba(28,24,20,0.45)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
          <p className="min-w-0 truncate text-sm">{file.name}</p>
          <div className="flex shrink-0 items-center gap-3">
            {html && (
              <a className="text-[12px] text-[var(--ink-soft)]" href={pageUrl} target="_blank" rel="noreferrer">
                Open page
              </a>
            )}
            <a className="text-[12px] text-[var(--ink-soft)]" href={downloadSrc(file)}>
              Download
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div
          className="relative min-h-0 flex-1 bg-white"
          onMouseDown={(e) => {
            e.stopPropagation();
            frameRef.current?.focus();
          }}
        >
          {html ? (
            <iframe
              ref={frameRef}
              title={file.name}
              src={src}
              className="block h-full w-full border-0 bg-white"
              style={{ pointerEvents: "auto" }}
              allow="fullscreen; gamepad; pointer-lock; autoplay; clipboard-write"
              allowFullScreen
              tabIndex={0}
              onLoad={() => frameRef.current?.focus()}
            />
          ) : image ? (
            <img src={src} alt={file.name} className="mx-auto h-full w-full object-contain p-6" />
          ) : pdf ? (
            <iframe title={file.name} src={src} className="h-full w-full border-0 bg-white" />
          ) : mermaid && text && !text.startsWith("Couldn't") ? (
            <div className="h-full overflow-auto">
              <MermaidChart source={text} />
            </div>
          ) : sheet && text && !text.startsWith("Couldn't") ? (
            <div className="h-full overflow-auto">
              <SheetTable source={text} />
            </div>
          ) : drawio && text && text.trim().startsWith("<") ? (
            <DrawioEmbed xml={text} />
          ) : (
            <pre className="h-full overflow-auto bg-white p-6 text-sm whitespace-pre-wrap">{text ?? "Loading…"}</pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function Inspector({ compact = false }: { compact?: boolean }) {
  const {
    agents,
    jobs,
    selectedId,
    live,
    openListId,
    assignWork,
    deleteAgent,
    closeStage,
    openDesk,
    stageMode,
    updateAgent,
    taskTick,
    chains,
    openPreview,
    setOpenListId,
    traces,
    setGalleryOpen,
  } = useFactory();
  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  const { tools } = useSkillCatalog();
  const state = agent ? live[agent.id] : undefined;
  const [prompt, setPrompt] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [tray, setTray] = useState<ListItem[]>([]);
  const [handError, setHandError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAbout, setDraftAbout] = useState("");
  const [tab, setTab] = useState<"work" | "files" | "record" | "setup">("work");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [fetchedTrace, setFetchedTrace] = useState<import("@/lib/types").TraceEvent[]>([]);
  const stick = useRef(true);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!agent) {
      setTray([]);
      return;
    }
    let stop = false;
    fetch(`${API_URL}/api/agents/${agent.id}/tray`)
      .then((r) => r.json())
      .then((data) => {
        if (!stop) setTray(data.items || []);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [agent?.id, taskTick, state?.job?.status]);

  useEffect(() => {
    const id = state?.job?.id;
    if (!id) {
      setFetchedTrace([]);
      return;
    }
    let stop = false;
    fetch(`${API_URL}/api/jobs/${id}/trace`)
      .then((r) => r.json())
      .then((data) => {
        if (!stop && Array.isArray(data.events)) setFetchedTrace(data.events);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [state?.job?.id, state?.job?.status]);

  const thread = useMemo(() => {
    if (!agent) return [] as Job[];
    const recent = jobs.filter((j) => j.agent_id === agent.id && !isNoise(j));
    const liveJob = state?.job;
    const liveWorking = Boolean(
      liveJob && ["queued", "thinking", "tool"].includes(liveJob.status)
    );
    const lastSettled = recent.find((j) => ["done", "blocked", "cancelled"].includes(j.status));
    const out: Job[] = [];
    if (liveWorking && liveJob) {
      if (lastSettled && lastSettled.id !== liveJob.id) out.push(lastSettled);
      out.push(liveJob);
    } else if (lastSettled) {
      out.push(lastSettled);
    } else if (liveJob?.prompt) {
      out.push(liveJob);
    }
    return out;
  }, [agent, jobs, state?.job]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || !stick.current) return;
    el.scrollTop = el.scrollHeight;
  }, [thread.length, state?.tokens, state?.job?.status]);

  if (!agent) {
    return (
      <aside className="glass h-full min-h-0 rounded-[28px] p-5">
        <p className="text-[var(--ink-soft)]">Select a desk.</p>
      </aside>
    );
  }

  function onHand(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    const text = prompt.trim();
    setHandError(null);
    assignWork({ agentId: agent.id, text, listId: writableListId(openListId) })
      .then(() => setPrompt(""))
      .catch((err) => setHandError(err instanceof Error ? err.message : "Could not assign"));
  }

  async function stopJob() {
    if (!job || stopping) return;
    setStopping(true);
    try {
      const r = await fetch(`${API_URL}/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (!r.ok) setHandError("Could not stop that job.");
    } finally {
      setStopping(false);
    }
  }

  function toggleStrength(id: string) {
    const split = splitPacks(agent.strengths, tools);
    const domain = split.domain.includes(id)
      ? split.domain.filter((x) => x !== id)
      : [...split.domain, id].slice(-2);
    const next = [...(domain.length ? domain : split.domain), ...split.tools];
    updateAgent(agent.id, { strengths: next.length ? next : [id] }).catch(() => undefined);
  }

  function toggleTool(id: string) {
    const next = agent.strengths.includes(id)
      ? agent.strengths.filter((x) => x !== id)
      : [...agent.strengths, id];
    updateAgent(agent.id, { strengths: next }).catch(() => undefined);
  }

  const portrait = portraitFor(agent, API_URL);
  const job = state?.job;
  const liveJobId = job?.id;
  const working = Boolean(job) && ["queued", "thinking", "tool"].includes(job?.status || "");
  const waiting = tray.filter((item) => item.status === "assigned");
  const history = jobs.filter((j) => j.agent_id === agent.id && !isNoise(j)).slice(0, 24);
  const allFiles = history.flatMap((item) =>
    filesForJob(item, item.id === liveJobId ? state?.artifacts || [] : [], liveJobId).map((file) => ({
      job: item,
      file,
    }))
  );
  const trace = (job?.id && traces[job.id]) || state?.trace || fetchedTrace;

  return (
    <aside className="glass flex h-full min-h-0 flex-col rounded-[28px] p-4">
      <div className="flex shrink-0 items-center gap-3">
        <img src={portrait} alt="" className="h-12 w-12 rounded-2xl object-cover" />
        <div className="min-w-0 flex-1">
          <h2 className="display truncate text-[1.45rem] leading-tight">{agent.name}</h2>
          {agent.description && (
            <p className="truncate text-sm text-[var(--ink-soft)]">{agent.description}</p>
          )}
        </div>
        {stageMode !== "desk" && (
          <button type="button" className="btn shrink-0" onClick={() => openDesk(agent.id)}>
            3D desk
          </button>
        )}
      </div>
      <div className="mt-3 shrink-0">
        <SegmentedControl
          ariaLabel="Desk tabs"
          value={tab}
          onChange={setTab}
          options={
            compact
              ? [
                  { id: "work", label: "Work" },
                  { id: "setup", label: "Setup" },
                ]
              : [
                  { id: "work", label: "Work" },
                  { id: "files", label: "Files" },
                  { id: "record", label: "Record" },
                  { id: "setup", label: "Setup" },
                ]
          }
        />
      </div>
      {working && (
        <div className="mt-3 flex shrink-0 gap-2">
          <button type="button" className="btn" disabled={stopping} onClick={stopJob}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        </div>
      )}
      {waiting.length > 0 && (
        <p className="mt-2 shrink-0 text-xs text-[var(--ink-soft)]">{waiting.length} waiting on this desk</p>
      )}

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="mt-3 min-h-0 flex-1 space-y-3 overflow-auto rounded-2xl bg-white/40 p-3"
      >
        {tab === "work" && (
          <>
            {working && (
              <WorkTrace
                events={trace}
                startedAt={job?.created_at || job?.updated_at}
                tokens={Math.max(1, (state?.tokens || "").length / 4)}
                model={agent.model}
              />
            )}
            {thread.length === 0 && (
              <p className="text-sm text-[var(--ink-soft)]">
                Drop a to-do from the left, or type a task below.
              </p>
            )}
            {thread.map((item) => {
              const active = item.id === liveJobId && working;
              const reply = jobReply(item, state?.tokens || "", state?.think || "", liveJobId, active);
              const files = filesForJob(item, state?.artifacts || [], liveJobId);
              const viewFile = files.find(isHtmlFile) || files.find(isMermaidFile) || files.find(isSheetFile) || files.find(isPdfFile) || files.find(isDrawioFile) || files.find(isImageFile) || files[0];
              const extraViews = files.filter((file) => file.id !== viewFile?.id);
              const hero = item.status === "done" && viewFile;
              return (
                <article key={item.id} className={`space-y-2 rounded-2xl px-3 py-3 ${hero ? "bg-white shadow-sm" : "bg-white/70"}`}>
                  <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--ink-soft)]">
                    {item.status === "blocked"
                      ? "Needs attention"
                      : item.status === "cancelled"
                        ? "Stopped"
                        : active
                          ? "Working"
                          : item.status === "done"
                            ? "Result"
                            : "On the desk"}
                  </p>
                  <p className="text-sm font-medium">{clip(taskTitle({ prompt: item.prompt }), 240)}</p>
                  {item.project_name && <p className="text-[11px] text-[var(--ink-soft)]">{item.project_name}</p>}
                  {item.chain_id && chains[item.chain_id] && (
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      {chains[item.chain_id].steps.find((s) => s.id === item.chain_step_id)?.seq || 1} of{" "}
                      {chains[item.chain_id].steps.length}
                    </p>
                  )}
                  {(reply || active) && (
                    <div className="text-sm">
                      {reply ? (
                        <RichText text={reply} />
                      ) : (
                        <p className="text-sm">
                          {/waiting for the local gpu/i.test(state?.job?.caption || "")
                            ? "Waiting for the local GPU…"
                            : `${agent.name} is working…`}
                        </p>
                      )}
                      {active && (
                        <span className="ml-1 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-[var(--ink)] align-middle" />
                      )}
                    </div>
                  )}
                  {item.status === "blocked" && item.error && item.error !== reply && (
                    <p className="text-xs text-[var(--ink-soft)]">{item.error}</p>
                  )}
                  {files.length > 0 && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {viewFile && (
                        <button
                          type="button"
                          className="btn btn-solid px-3 py-1 text-xs"
                          onClick={() => openPreview(item.id, viewFile)}
                        >
                          View
                        </button>
                      )}
                      {viewFile && (
                        <a className="text-[11px] text-[var(--ink-soft)] underline" href={downloadSrc(viewFile)}>
                          Download
                        </a>
                      )}
                      {extraViews.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="text-[11px] text-[var(--ink-soft)] underline"
                          onClick={() => openPreview(item.id, a)}
                        >
                          {fileKindLabel(a)}
                        </button>
                      ))}
                    </div>
                  )}
                  {item.status === "blocked" && (
                    <button
                      type="button"
                      className="btn px-3 py-1 text-xs"
                      onClick={() => {
                        assignWork({
                          agentId: agent.id,
                          text: item.prompt,
                          listId: writableListId(openListId),
                        }).catch((err) =>
                          setHandError(err instanceof Error ? err.message : "Could not assign")
                        );
                      }}
                    >
                      Hand it again
                    </button>
                  )}
                </article>
              );
            })}
          </>
        )}
        {tab === "files" && (
          <>
            {allFiles.length === 0 && <p className="text-sm text-[var(--ink-soft)]">No files on this desk yet.</p>}
            {allFiles.map(({ job: item, file }) => (
              <div key={file.id} className="flex items-center justify-between gap-2 rounded-2xl bg-white/70 px-3 py-2">
                <p className="min-w-0 truncate text-sm">{file.name}</p>
                <button type="button" className="btn btn-compact" onClick={() => openPreview(item.id, file)}>
                  {fileKindLabel(file)}
                </button>
              </div>
            ))}
          </>
        )}
        {tab === "record" && (
          <>
            <button type="button" className="btn px-3 py-1 text-xs" onClick={() => setOpenListId("done")}>
              Done list
            </button>
            <button type="button" className="btn px-3 py-1 text-xs" onClick={() => setGalleryOpen(true)}>
              All results
            </button>
            {history.map((item) => (
              <p key={item.id} className="truncate text-sm text-[var(--ink-soft)]">
                {item.status} · {clip(taskTitle({ prompt: item.prompt }), 80)}
              </p>
            ))}
          </>
        )}
        {tab === "setup" && (
          <>
            <p className="text-[11px] text-[var(--ink-soft)]">First skill on is the job. Second is extra.</p>
            <div className="flex flex-wrap gap-2">
              {STRENGTHS.map((s) => (
                <Chip key={s.id} on={agent.strengths.includes(s.id)} pigment={agent.pigment} onClick={() => toggleStrength(s.id)}>
                  {s.label}
                </Chip>
              ))}
            </div>
            {tools.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-soft)]">Tools</span>
                {tools.map((s) => (
                  <Chip key={s.id} on={agent.strengths.includes(s.id)} pigment={agent.pigment} onClick={() => toggleTool(s.id)}>
                    {s.label}
                  </Chip>
                ))}
              </div>
            )}
            <ModelPicker
              compact
              value={agent.model}
              onChange={(id) => {
                if (id === agent.model) return;
                updateAgent(agent.id, { model: id }).catch(() => undefined);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const next = randomLook();
                  updateAgent(agent.id, { look: next }).catch(() => undefined);
                }}
              >
                New look
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setDraftName(agent.name);
                  setDraftAbout(agent.description || "");
                  setEditing((open) => !open);
                }}
              >
                Edit
              </button>
              <button type="button" className="btn btn-danger" onClick={() => setConfirmRemove(true)}>
                Remove
              </button>
            </div>
            {editing && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateAgent(agent.id, {
                    name: draftName.trim() || agent.name,
                    description: draftAbout,
                  }).then(() => setEditing(false));
                }}
              >
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  className="rounded-full bg-white px-4 py-2 text-sm outline-none"
                />
                <input
                  value={draftAbout}
                  onChange={(e) => setDraftAbout(e.target.value)}
                  placeholder="What this desk is for"
                  className="rounded-full bg-white px-4 py-2 text-sm outline-none"
                />
                <label className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">
                  Pigment
                  <input type="color" value={agent.pigment} onChange={(e) => updateAgent(agent.id, { pigment: e.target.value })} />
                </label>
                <button type="submit" className="btn btn-solid w-fit">
                  Save
                </button>
              </form>
            )}
          </>
        )}
      </div>

      <form onSubmit={onHand} className="mt-4 flex shrink-0 gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Hand ${agent.name} a task`}
          className="flex-1 rounded-full bg-white/70 px-4 py-2 text-sm outline-none"
        />
        <button type="submit" className="btn btn-solid" disabled={working}>
          {working ? `${waiting.length ? waiting.length + 1 : ""} Working` : "Assign"}
        </button>
      </form>
      {handError && <p className="mt-2 text-xs text-[var(--alert)]">{handError}</p>}
      <Modal open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${agent.name}?`}>
        <p className="text-sm text-[var(--ink-soft)]">This desk and its files go with them.</p>
        <div className="mt-4 flex gap-2">
          <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>
            Keep
          </button>
          <button
            type="button"
            className="btn btn-solid"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await deleteAgent(agent.id);
                closeStage();
                setConfirmRemove(false);
              } finally {
                setDeleting(false);
              }
            }}
          >
            {deleting ? "Removing…" : "Remove"}
          </button>
        </div>
      </Modal>
    </aside>
  );
}
