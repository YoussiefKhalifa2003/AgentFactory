"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useFactory } from "@/lib/factory";
import { Artifact, bayCopy, Job, portrait, strengthLabel, taskTitle } from "@/lib/types";
import { clip, collapseRepeats, friendlyText, isNoise } from "@/lib/text";
import { bestView, downloadSrc, fileKindLabel, filesForJob } from "@/lib/files";
import { apiUrl } from "@/lib/config";
import { parseVoiceCommand, resolveMeetingListId, speechAvailable, startListen } from "@/lib/voice";

export function DeskScreen({
  onPreview,
}: {
  onPreview: (jobId: string, file: Artifact) => void;
}) {
  const { agents, selectedId, live, cancelJob, assignWork } = useFactory();
  const agent = agents.find((a) => a.id === selectedId) || agents[0] || null;
  const state = agent ? live[agent.id] : undefined;
  const job = state?.job || null;
  const [hand, setHand] = useState("");
  const [busy, setBusy] = useState(false);
  const [eyes, setEyes] = useState<File[]>([]);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center px-8 text-center">
        <p className="text-sm text-[var(--ink-soft)]">No agent selected. Open Floor and tap a bay.</p>
      </div>
    );
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = hand.trim() || (eyes.length ? "Look at this" : "");
    if ((!text && !eyes.length) || !agent) return;
    setBusy(true);
    try {
      await assignWork({
        agentId: agent.id,
        text,
        listId: "inbox",
        files: eyes.length ? eyes : undefined,
      });
      setHand("");
      setEyes([]);
    } finally {
      setBusy(false);
    }
  }

  const working = Boolean(job && ["queued", "thinking", "tool"].includes(job.status));
  const files = job ? filesForJob(job, state?.artifacts || [], state?.job?.id) : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-4 pb-3">
        <img src={portrait(agent)} alt="" className="h-11 w-11 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <p className="display text-[1.35rem] leading-none" style={{ color: agent.pigment }}>
            {agent.name}
          </p>
          <p className="mt-1 truncate text-[13px] text-[var(--ink-soft)]">
            {working && job?.caption
              ? job.caption
              : (agent.strengths || []).slice(0, 2).map(strengthLabel).join(" · ") || "Ready"}
          </p>
        </div>
      </div>
      {bayCopy(agent) ? (
        <p className="shrink-0 line-clamp-3 px-4 pb-2 text-[13px] leading-5 text-[var(--ink-soft)]">{bayCopy(agent)}</p>
      ) : null}

      <Thread
        job={job}
        liveTokens={state?.tokens || ""}
        liveThink={state?.think || ""}
        working={working}
        trace={state?.trace}
      />

      {job && files.length > 0 && (
        <FileStrip job={job} files={files} onPreview={onPreview} />
      )}

      {working && job && (
        <button
          type="button"
          className="btn mx-4 mb-2"
          onClick={() => cancelJob(job.id)}
        >
          Cancel this job
        </button>
      )}

      <form onSubmit={send} className="flex shrink-0 flex-col gap-2 px-3 py-2">
        {eyes.length > 0 && (
          <p className="truncate text-[12px] text-[var(--ink-soft)]">{eyes.map((f) => f.name).join(", ")}</p>
        )}
        <div className="flex gap-2">
          <input
            value={hand}
            onChange={(e) => setHand(e.target.value)}
            placeholder={`Hand ${agent.name} a task`}
            className="min-h-11 min-w-0 flex-1 rounded-full bg-white px-4 text-[16px]"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*,.pdf"
            className="hidden"
            onChange={(e) => {
              const list = [...(e.target.files || [])];
              if (list.length) setEyes(list.slice(0, 4));
            }}
          />
          <button type="button" className="btn px-3" onClick={() => fileRef.current?.click()}>
            Photo
          </button>
          {speechAvailable() && (
            <button
              type="button"
              className={`btn px-3 ${listening ? "btn-solid" : ""}`}
              onPointerDown={() => {
                setListening(true);
                startListen({
                  onInterim: (t) => setHand(t),
                  onFinal: (t) => {
                    setHand(t);
                    const intent = parseVoiceCommand(t, agents);
                    if (intent.action === "cancel" && job) cancelJob(job.id);
                    if (intent.action === "assign" && intent.text) {
                      const target = intent.agentId || agent.id;
                      resolveMeetingListId(apiUrl(), intent.meeting).then((listId) => {
                        assignWork({ agentId: target, text: intent.text, listId }).catch(() => undefined);
                      });
                      setHand("");
                    }
                  },
                  onEnd: () => setListening(false),
                });
              }}
              onPointerUp={() => setListening(false)}
            >
              Mic
            </button>
          )}
          <button type="submit" className="btn btn-solid px-4" disabled={(!hand.trim() && !eyes.length) || busy}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function Thread({
  job,
  liveTokens,
  liveThink,
  working,
  trace,
}: {
  job: Job | null;
  liveTokens: string;
  liveThink: string;
  working: boolean;
  trace?: { kind?: string; detail?: string; label?: string }[];
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [liveTokens, liveThink, job?.output, job?.id]);

  if (!job) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <p className="text-sm text-[var(--ink-soft)]">Idle. Hand them a task below.</p>
      </div>
    );
  }

  if (isNoise(job) && !working) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
        <p className="text-[13px] font-medium">{taskTitle(job)}</p>
        <p className="mt-3 text-sm text-[var(--ink-soft)]">Interrupted — assign it again.</p>
      </div>
    );
  }

  const live = working ? friendlyText(liveTokens || liveThink, true) : "";
  const recap = !working ? collapseRepeats(friendlyText(job.output || "")) : "";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
      <p className="text-[13px] font-medium">{taskTitle(job)}</p>
      {(() => {
        const ev = [...(trace || [])]
          .reverse()
          .find((e) => ["critic.passed", "critic.finding", "critic.skipped"].includes(e.kind || ""));
        return ev ? (
          <p className="mt-2 text-[13px] text-[var(--ink-soft)]">Verdict · {ev.detail || ev.label || ev.kind}</p>
        ) : null;
      })()}
      {live ? (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-[var(--ink-soft)]">{clip(live, 2400)}</p>
      ) : null}
      {recap ? (
        <p className="mt-3 whitespace-pre-wrap text-[15px] leading-6">{clip(recap, 4000)}</p>
      ) : null}
      {!live && !recap && job.status === "blocked" && (
        <p className="mt-3 text-[15px] text-[var(--alert)]">{job.error || "Couldn't finish that job."}</p>
      )}
      <div ref={end} />
    </div>
  );
}

function FileStrip({
  job,
  files,
  onPreview,
}: {
  job: Job;
  files: Artifact[];
  onPreview: (jobId: string, file: Artifact) => void;
}) {
  const view = bestView(files);
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto hide-scroll px-3 py-2">
      {view && (
        <button type="button" className="btn shrink-0" onClick={() => onPreview(job.id, view)}>
          View {fileKindLabel(view)}
        </button>
      )}
      {files.map((file) => (
        <a key={file.id} className="btn shrink-0" href={downloadSrc(file)} download={file.name}>
          {file.name}
        </a>
      ))}
    </div>
  );
}
