"use client";

import { DragEvent, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Agent, API_URL, STRENGTHS, modelShortName, strengthLabel } from "@/lib/types";
import { splitPacks } from "@/lib/skills";
import { useFactory } from "@/lib/factory";
import { parseTaskDrag } from "@/lib/tasks";
import { portraitFor } from "@/lib/look";
import { isWorking, statusLabel } from "@/lib/status";
import { StatusPill } from "./ui/StatusPill";

function bayCopy(agent: Agent) {
  const desc = (agent.description || "").trim();
  if (desc) return desc;
  const first = agent.strengths?.[0];
  return STRENGTHS.find((row) => row.id === first)?.copy || "";
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
  const liveNow = Boolean(state?.job) && isWorking(state.job?.status);
  const chain = state?.job?.chain_id ? chains[state.job.chain_id] : null;
  const chainLive =
    Boolean(liveNow && chain) &&
    chain?.status !== "done" &&
    chain?.status !== "cancelled" &&
    chain?.status !== "blocked";
  const portrait = portraitFor(agent, API_URL);
  const chips = splitPacks(agent.strengths).domain.slice(0, 2);
  const copy = bayCopy(agent);
  const selected = selectedId === agent.id;

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
      aria-selected={selected}
      className={`bay h-full min-h-[15.5rem] w-full cursor-pointer bg-white p-4 text-left ${liveNow ? "is-live" : ""} ${selected ? "is-selected" : ""} ${dropOver ? "is-drop" : ""}`}
      style={{
        ["--pigment" as string]: agent.pigment,
        outline: highlighted && !dropOver ? `1.5px solid ${agent.pigment}` : undefined,
        outlineOffset: 3,
      }}
    >
      {dropOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 text-sm font-medium">
          Assign to {agent.name}
        </div>
      )}
      <div className="relative z-[1] flex min-w-0 items-center gap-3">
        <div className="relative shrink-0">
          <img src={portrait} alt="" className="h-12 w-12 rounded-xl object-cover" />
          {selected && (
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ink)] text-white">
              <Check size={10} />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[1.15rem] leading-tight">{agent.name}</h2>
          <p className="mt-0.5 truncate text-[12px] text-[var(--ink-soft)]">
            {copy ? copy.split(".")[0] : chips.map(strengthLabel).join(" · ")}
          </p>
        </div>
      </div>
      <div className="relative z-[1] mt-3 flex items-center gap-2">
        <StatusPill status={state?.job?.status} activity={activity} caption={line} />
        {liveNow && (
          <span className="wave" aria-hidden>
            <i /><i /><i /><i /><i />
          </span>
        )}
      </div>
      <div className="relative z-[1] mt-3 min-w-0 flex-1">
        {copy ? <p className="line-clamp-3 text-[13px] leading-5 text-[var(--ink-soft)]">{copy}</p> : null}
        <div className={`flex min-h-9 items-center gap-2 ${copy ? "mt-2.5" : ""}`}>
          <div className="flex min-h-7 min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden">
            {chips.map((id) => (
              <span
                key={id}
                className="chip shrink-0"
              >
                {strengthLabel(id)}
              </span>
            ))}
            <span className="chip shrink-0">{modelShortName(agent.model)}</span>
          </div>
          <button
            type="button"
            className="btn btn-compact shrink-0 px-3"
            onClick={(e) => {
              e.stopPropagation();
              openDesk(agent.id);
            }}
          >
            Desk
          </button>
        </div>
      </div>
    </div>
  );
}
