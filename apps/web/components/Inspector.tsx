"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useFactory } from "@/lib/factory";
import { API_URL, Artifact, Job, ListItem, STRENGTHS, badgeDataUrl, pfpSrc } from "@/lib/types";
import { splitPacks, useSkillCatalog } from "@/lib/skills";
import { taskTitle } from "@/lib/tasks";
import { RichText } from "@/lib/rich-text";
import { ModelPicker } from "./ModelPicker";

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
    return "That OpenCode free model isn’t available here. Pick OpenRouter or a local model.";
  }
  if (/creditserror|payment method|opencode\.ai\/workspace/i.test(raw)) {
    return "OpenCode ran out of credit. Switch this bay to OpenRouter or a local model.";
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

function fileKindLabel(file: Artifact) {
  if (isHtmlFile(file)) return "Page";
  if (isMermaidFile(file)) return "Chart";
  if (isDrawioFile(file)) return "draw.io";
  if (isSheetFile(file)) return "Sheet";
  if (isPdfFile(file)) return "PDF";
  if (isImageFile(file)) return "Image";
  return file.name;
}

function downloadLabel(file: Artifact) {
  const kind = fileKindLabel(file);
  if (kind === file.name) return `Download ${file.name}`;
  return `Download ${kind}`;
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
      className="h-[70vh] w-full border-0"
    />
  );
}

function previewSrc(jobId: string, file: Artifact) {
  if (isHtmlFile(file)) {
    const rel = file.name.replace(/^\/+/, "") || "index.html";
    return `${API_URL}/api/jobs/${jobId}/site/${rel}`;
  }
  return `${API_URL}/api/artifacts/${file.id}/file`;
}

function downloadSrc(file: Artifact) {
  return `${API_URL}/api/artifacts/${file.id}/file?download=1`;
}

function FilePreview({
  jobId,
  file,
  onClose,
}: {
  jobId: string;
  file: Artifact;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const html = isHtmlFile(file);
  const image = isImageFile(file);
  const drawio = isDrawioFile(file);
  const mermaid = isMermaidFile(file);
  const sheet = isSheetFile(file);
  const pdf = isPdfFile(file);
  const pageUrl = html ? previewSrc(jobId, file) : "";

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

  const wide = drawio || mermaid || sheet || pdf || html;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(28,24,20,0.45)] p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[96vh] w-full flex-col overflow-hidden rounded-[28px] bg-[var(--paper)] shadow-xl ${
          wide ? "max-w-[96vw]" : "max-w-4xl"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0">
            <p className="text-[11px] tracking-[0.2em] uppercase text-[var(--ink-soft)]">
              {fileKindLabel(file)}
            </p>
            <p className="truncate text-sm font-medium">{file.name}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {html && (
              <a className="btn" href={pageUrl} target="_blank" rel="noreferrer">
                Open full page
              </a>
            )}
            <a className="btn" href={downloadSrc(file)}>
              Download
            </a>
            <button type="button" className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
        <div
          className="relative min-h-0 flex-1 bg-black"
          onMouseDown={(e) => {
            e.stopPropagation();
            frameRef.current?.focus();
          }}
        >
          {html ? (
            <iframe
              ref={frameRef}
              title={file.name}
              src={pageUrl}
              className="block h-[min(82vh,920px)] min-h-[480px] w-full border-0 bg-black"
              style={{ pointerEvents: "auto" }}
              allow="fullscreen; gamepad; pointer-lock; autoplay; clipboard-write"
              allowFullScreen
              tabIndex={0}
              onLoad={() => frameRef.current?.focus()}
            />
          ) : image ? (
            <img
              src={previewSrc(jobId, file)}
              alt={file.name}
              className="mx-auto max-h-[70vh] object-contain p-4"
            />
          ) : pdf ? (
            <iframe
              title={file.name}
              src={previewSrc(jobId, file)}
              className="h-[70vh] w-full border-0"
            />
          ) : mermaid && text && !text.startsWith("Couldn't") ? (
            <MermaidChart source={text} />
          ) : sheet && text && !text.startsWith("Couldn't") ? (
            <SheetTable source={text} />
          ) : drawio && text && text.trim().startsWith("<") ? (
            <DrawioEmbed xml={text} />
          ) : (
            <pre className="max-h-[70vh] overflow-auto bg-white p-4 text-sm whitespace-pre-wrap">
              {text ?? "Loading…"}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function Inspector({ compact = false }: { compact?: boolean }) {
  const {
    agents,
    jobs,
    selectedId,
    live,
    stageOpen,
    assignWork,
    toggleStage,
    deleteAgent,
    closeStage,
    updateAgent,
    setAgents,
    taskTick,
  } = useFactory();
  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  const { tools } = useSkillCatalog();
  const state = agent ? live[agent.id] : undefined;
  const [prompt, setPrompt] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<{ jobId: string; file: Artifact } | null>(null);
  const [tray, setTray] = useState<ListItem[]>([]);
  const [showEarlier, setShowEarlier] = useState(false);
  const [handError, setHandError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftAbout, setDraftAbout] = useState("");
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

  const thread = useMemo(() => {
    if (!agent) return [] as Job[];
    const recent = jobs.filter((j) => j.agent_id === agent.id && !isNoise(j));
    const visible = showEarlier ? recent.slice().reverse() : recent.slice(0, 8).reverse();
    const current = state?.job;
    const out: Job[] = [];
    for (const job of visible) {
      const prev = out[out.length - 1];
      if (prev && prev.prompt === job.prompt && (prev.output || "") === (job.output || "")) {
        continue;
      }
      out.push(job);
    }
    if (current && current.prompt && !out.some((j) => j.id === current.id)) {
      out.push(current);
    }
    return out;
  }, [agent, jobs, state?.job, showEarlier]);

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
    assignWork({ agentId: agent.id, text, listId: "inbox" })
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

  const portrait = pfpSrc(agent.pfp) || badgeDataUrl(agent.name, agent.pigment);
  const job = state?.job;
  const liveJobId = job?.id;
  const working = Boolean(job) && !["done", "idle", "blocked"].includes(job?.status || "idle");
  const waiting = tray.filter((item) => item.status === "assigned");

  return (
    <aside className="glass flex h-full min-h-0 flex-col rounded-[28px] p-5">
      <div className="flex shrink-0 items-center gap-3">
        <img src={portrait} alt="" className="h-12 w-12 rounded-2xl object-cover" />
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.22em] uppercase text-[var(--ink-soft)]">Desk</p>
          <h2 className="text-xl font-semibold">{agent.name}</h2>
          {agent.description && (
            <p className="truncate text-sm text-[var(--ink-soft)]">{agent.description}</p>
          )}
        </div>
      </div>
      {!compact && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            {STRENGTHS.map((s) => {
              const on = agent.strengths.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggleStrength(s.id)}
                  className="rounded-full px-3 py-1 text-xs"
                  style={{
                    background: on
                      ? `color-mix(in srgb, ${agent.pigment} 22%, white)`
                      : "rgba(255,255,255,0.7)",
                    outline: on ? `1px solid ${agent.pigment}` : undefined,
                  }}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          {tools.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11px] tracking-[0.18em] uppercase text-[var(--ink-soft)]">
                Tools
              </span>
              {tools.map((s) => {
                const on = agent.strengths.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => toggleTool(s.id)}
                    className="rounded-full px-3 py-1 text-xs"
                    style={{
                      background: on
                        ? `color-mix(in srgb, ${agent.pigment} 22%, white)`
                        : "rgba(255,255,255,0.7)",
                      outline: on ? `1px solid ${agent.pigment}` : undefined,
                    }}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      <div className="mt-3 shrink-0">
        <ModelPicker
          compact
          value={agent.model}
          onChange={(id) => {
            if (id === agent.model) return;
            updateAgent(agent.id, { model: id }).catch(() => undefined);
          }}
        />
      </div>
      <div className="mt-3 flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => toggleStage(agent.id)}
          className="btn btn-pigment flex-1"
          style={{ background: agent.pigment }}
        >
          {stageOpen ? "Hide live floor" : "Live floor"}
        </button>
        <button
          type="button"
          disabled={deleting}
          onClick={async () => {
            if (!confirm(`Remove ${agent.name}? This desk and its files go with them.`)) return;
            setDeleting(true);
            try {
              await deleteAgent(agent.id);
              closeStage();
            } finally {
              setDeleting(false);
            }
          }}
          className="btn"
        >
          {deleting ? "Removing…" : "Remove"}
        </button>
        {working && (
          <button type="button" className="btn" disabled={stopping} onClick={stopJob}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
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
      </div>
      {editing && (
        <form
          className="mt-3 flex shrink-0 flex-col gap-2"
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
            <input
              type="color"
              value={agent.pigment}
              onChange={(e) => updateAgent(agent.id, { pigment: e.target.value })}
            />
          </label>
          <label className="btn w-fit cursor-pointer text-xs">
            Portrait
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.append("file", file);
                const r = await fetch(`${API_URL}/api/agents/${agent.id}/pfp`, { method: "POST", body });
                if (!r.ok) return;
                const updated = (await r.json()) as typeof agent;
                setAgents(agents.map((a) => (a.id === agent.id ? updated : a)));
              }}
            />
          </label>
          <button type="submit" className="btn btn-solid w-fit">
            Save
          </button>
        </form>
      )}

      {waiting.length > 0 && (
        <ul className="mt-3 shrink-0 space-y-1 text-xs text-[var(--ink-soft)]">
          {waiting.slice(0, 4).map((item) => (
            <li key={item.id} className="truncate">
              Waiting · {item.text}
            </li>
          ))}
          {waiting.length > 4 && <li>{waiting.length - 4} more waiting</li>}
        </ul>
      )}

      <div
        ref={scroller}
        onScroll={() => {
          const el = scroller.current;
          if (!el) return;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="mt-4 min-h-0 flex-1 space-y-3 overflow-auto rounded-2xl bg-white/40 p-3"
      >
        {jobs.filter((j) => j.agent_id === agent.id && !isNoise(j)).length > 8 && !showEarlier && (
          <button type="button" className="btn px-3 py-1 text-xs" onClick={() => setShowEarlier(true)}>
            Earlier on this desk
          </button>
        )}
        {thread.length === 0 && (
          <p className="text-sm text-[var(--ink-soft)]">
            Nothing on this desk yet. Assign a to-do from the left.
          </p>
        )}
        {thread.map((item) => {
          const active = item.id === liveJobId && working;
          const reply = jobReply(
            item,
            state?.tokens || "",
            state?.think || "",
            liveJobId,
            active
          );
          const files = filesForJob(item, state?.artifacts || [], liveJobId);
          const chartFile = files.find(isMermaidFile);
          const drawioFile = files.find(isDrawioFile);
          const sheetFile = files.find(isSheetFile);
          const pdfFile = files.find(isPdfFile);
          const imageFile = files.find(isImageFile);
          const viewFile =
            files.find(isHtmlFile) ||
            chartFile ||
            sheetFile ||
            pdfFile ||
            drawioFile ||
            imageFile ||
            files[0];
          const extraViews = files.filter((file) => file.id !== viewFile?.id);
          return (
            <article key={item.id} className="space-y-2 rounded-2xl bg-white/70 px-3 py-3">
              <p className="text-[11px] tracking-[0.16em] uppercase text-[var(--ink-soft)]">
                {item.status === "blocked"
                  ? "Needs attention"
                  : item.status === "cancelled"
                    ? "Stopped"
                    : active
                      ? "Working"
                      : item.status === "done"
                        ? "Done"
                        : "On the desk"}
              </p>
              <p className="text-sm font-medium">{clip(taskTitle({ prompt: item.prompt }), 240)}</p>
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
              {files.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {viewFile && (
                    <button
                      type="button"
                      className="btn btn-solid"
                      onClick={() => setPreview({ jobId: item.id, file: viewFile })}
                    >
                      View
                    </button>
                  )}
                  {extraViews.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className="btn"
                      onClick={() => setPreview({ jobId: item.id, file: a })}
                    >
                      View {fileKindLabel(a)}
                    </button>
                  ))}
                  {files
                    .filter((a) => !(pdfFile && /\.md$/i.test(a.name)))
                    .map((a) => (
                    <a key={a.id} className="btn" href={downloadSrc(a)}>
                      {downloadLabel(a)}
                    </a>
                  ))}
                </div>
              )}
              {item.status === "blocked" && (
                <button
                  type="button"
                  className="btn px-3 py-1 text-xs"
                  onClick={() => {
                    assignWork({ agentId: agent.id, text: item.prompt, listId: "inbox" }).catch((err) =>
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
      </div>

      {preview && (
        <FilePreview
          jobId={preview.jobId}
          file={preview.file}
          onClose={() => setPreview(null)}
        />
      )}

      <form onSubmit={onHand} className="mt-4 flex shrink-0 gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={`Hand ${agent.name} a task`}
          className="flex-1 rounded-full bg-white/70 px-4 py-2 text-sm outline-none"
        />
        <button type="submit" className="btn btn-solid" disabled={working}>
          {working ? "Working" : "Assign"}
        </button>
      </form>
      {handError && <p className="mt-2 text-xs text-[#b42318]">{handError}</p>}
    </aside>
  );
}
