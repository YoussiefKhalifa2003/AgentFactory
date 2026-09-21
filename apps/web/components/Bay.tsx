"use client";

import { DragEvent, useState } from "react";
import { Agent, badgeDataUrl, pfpSrc, strengthLabel } from "@/lib/types";
import { useFactory } from "@/lib/factory";
import { parseTaskDrag } from "@/lib/tasks";

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
  const { live, selectedId, assignWork, select } = useFactory();
  const [dropOver, setDropOver] = useState(false);
  const state = live[agent.id];
  const activity = state?.job?.activity || "idle";
  const liveNow = Boolean(state?.job) && !["done", "idle", "blocked"].includes(state.job?.status || activity);
  const portrait = pfpSrc(agent.pfp) || badgeDataUrl(agent.name, agent.pigment);

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
      className={`bay w-full cursor-pointer rounded-[24px] bg-white p-5 text-left shadow-sm ${liveNow ? "is-live" : ""} ${selectedId === agent.id ? "is-selected" : ""} ${dropOver ? "is-drop" : ""}`}
      style={{
        ["--pigment" as string]: agent.pigment,
        outline: highlighted && !dropOver ? `2px solid ${agent.pigment}` : undefined,
        outlineOffset: 3,
      }}
    >
      <div className="relative z-[1] flex items-center gap-4">
        <img src={portrait} alt="" className="h-12 w-12 rounded-2xl object-cover" />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">{agent.name}</h2>
          <p className="truncate text-sm text-[var(--ink-soft)]">
            {agent.description || "Ready for a job"}
          </p>
        </div>
      </div>
      <div className="relative z-[1] mt-5 flex flex-wrap gap-2">
        {agent.strengths.map((s) => (
          <span
            key={s}
            className="rounded-full px-3 py-1 text-xs"
            style={{
              background: `color-mix(in srgb, ${agent.pigment} 14%, white)`,
            }}
          >
            {strengthLabel(s)}
          </span>
        ))}
      </div>
      <div className="relative z-[1] mt-4 flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--ink-soft)]">
          {dropOver ? `Assign to ${agent.name}` : statusLabel(activity, state?.job?.status)}
        </p>
      </div>
    </div>
  );
}
