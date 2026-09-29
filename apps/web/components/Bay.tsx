"use client";

import { DragEvent, useEffect, useState } from "react";
import { Agent, API_URL, STRENGTHS, badgeDataUrl, pfpSrc, strengthLabel } from "@/lib/types";
import { splitPacks } from "@/lib/skills";
import { useFactory } from "@/lib/factory";
import { parseTaskDrag } from "@/lib/tasks";

function bayCopy(agent: Agent) {
  const desc = (agent.description || "").trim();
  if (desc) return desc;
  const first = agent.strengths?.[0];
  return STRENGTHS.find((row) => row.id === first)?.copy || "";
}

function statusLabel(activity: string, status?: string) {
  if (["queued", "thinking", "tool"].includes(status || activity)) return "Working";
  if (status === "done" || activity === "done") return "Done";
  if (status === "blocked" || activity === "blocked") return "Needs attention";
  return "Ready";
}

export function Bay({
  agent,
  highlighted = false,
}: {
  agent: Agent;
  highlighted?: boolean;
}) {
  const { live, selectedId, assignWork, select, taskTick, chains, openDesk } = useFactory();
  const [dropOver, setDropOver] = useState(false);
  const [waiting, setWaiting] = useState(0);
  const state = live[agent.id];
  const activity = state?.job?.activity || "idle";
  const liveNow = Boolean(state?.job) && ["queued", "thinking", "tool"].includes(state.job?.status || "");
  const chain = state?.job?.chain_id ? chains[state.job.chain_id] : null;
  const chainLive =
    Boolean(liveNow && chain) &&
    chain?.status !== "done" &&
    chain?.status !== "cancelled" &&
    chain?.status !== "blocked";
  const stepNo = chainLive
    ? chain?.steps.find((s) => s.id === state?.job?.chain_step_id)?.seq
    : undefined;
  const portrait = pfpSrc(agent.pfp) || badgeDataUrl(agent.name, agent.pigment);
  const chips = splitPacks(agent.strengths).domain.slice(0, 2);
  const copy = bayCopy(agent);

  useEffect(() => {
    let stop = false;
    fetch(`${API_URL}/api/agents/${agent.id}/tray`)
      .then((r) => r.json())
      .then((data) => {
        if (stop) return;
        const items = (data.items || []) as { status?: string }[];
        setWaiting(items.filter((item) => item.status === "assigned").length);
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [agent.id, liveNow, taskTick]);

  function onDragOver(e: DragEvent) {
    const types = [...e.dataTransfer.types];
    if (!types.some((t) => t.includes("foundry") || t.includes("meeting") || t === "text/plain")) {
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropOver(true);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDropOver(false);
    const item = parseTaskDrag(e.dataTransfer);
    if (!item) return;
    select(agent.id);
    assignWork({ itemId: item.id, agentId: agent.id }).catch(() => undefined);
  }

  const line = dropOver
    ? `Assign to ${agent.name}`
    : liveNow && state?.job?.caption
      ? state.job.caption
      : waiting
        ? `${waiting} waiting`
        : statusLabel(activity, state?.job?.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => select(agent.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select(agent.id);
        }
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropOver(false)}
      onDrop={onDrop}
      aria-selected={selectedId === agent.id}
      className={`bay w-full cursor-pointer bg-white p-4 text-left shadow-sm ${liveNow ? "is-live" : ""} ${selectedId === agent.id ? "is-selected" : ""} ${dropOver ? "is-drop" : ""}`}
      style={{
        ["--pigment" as string]: agent.pigment,
        outline: highlighted && !dropOver ? `1.5px solid ${agent.pigment}` : undefined,
        outlineOffset: 3,
      }}
    >
      <div className="relative z-[1] flex min-w-0 items-center gap-3">
        <img src={portrait} alt="" className="h-11 w-11 shrink-0 rounded-xl object-cover" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[1.15rem] leading-tight">{agent.name}</h2>
          <p className="mt-0.5 truncate text-[12px] text-[var(--ink-soft)]">
            {line}
            {stepNo ? ` · ${stepNo}/${chain?.steps.length}` : ""}
          </p>
        </div>
      </div>
      <div className="relative z-[1] mt-3 min-w-0">
        {copy ? (
          <p className="line-clamp-3 text-[13px] leading-5 text-[var(--ink-soft)]">{copy}</p>
        ) : null}
        <div className={`flex min-h-9 items-center gap-2 ${copy ? "mt-2.5" : ""}`}>
          <div className="flex min-h-7 min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">
            {chips.map((id) => (
              <span
                key={id}
                className="shrink-0 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_70%,white)] px-2.5 py-1 text-[11px] text-[var(--ink-soft)]"
              >
                {strengthLabel(id)}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-compact shrink-0 px-3"
            onClick={(e) => {
              e.stopPropagation();
              openDesk(agent.id);
            }}
          >
            3D desk
          </button>
        </div>
      </div>
    </div>
  );
}
