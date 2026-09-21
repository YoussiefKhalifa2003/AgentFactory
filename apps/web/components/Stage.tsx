"use client";

import { useFactory } from "@/lib/factory";
import { WorkerCanvas } from "./WorkerCanvas";

export function Stage() {
  const { agents, selectedId, live, closeStage } = useFactory();
  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  if (!agent) {
    return (
      <div className="glass flex h-full min-h-0 items-center justify-center rounded-[32px] text-sm text-[var(--ink-soft)]">
        Select a desk, then open Live floor.
      </div>
    );
  }
  const activity = live[agent.id]?.job?.activity || "idle";
  const caption = live[agent.id]?.job?.caption || `${agent.name} is on the floor`;
  const feed = (live[agent.id]?.tokens || live[agent.id]?.job?.output || "").trim();

  return (
    <div className="glass relative h-full min-h-0 overflow-hidden rounded-[32px]">
      <WorkerCanvas
        agent={agent}
        activity={activity}
        feed={feed}
        className="absolute inset-0 h-full w-full"
      />
      <div className="absolute inset-x-4 top-4 z-10 flex items-center gap-3">
        <button type="button" onClick={closeStage} className="btn shrink-0 shadow-sm">
          Hide live floor
        </button>
        <p className="min-w-0 truncate rounded-full bg-white/92 px-4 py-2 text-sm shadow-sm">
          {caption}
        </p>
      </div>
    </div>
  );
}
