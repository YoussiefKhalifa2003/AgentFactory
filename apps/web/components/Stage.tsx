"use client";

import { useFactory } from "@/lib/factory";
import { SceneRoot } from "./scene/SceneRoot";

export function Stage() {
  const { stageMode, closeStage, openOffice, openDesk, agents, selectedId } = useFactory();
  const agent = agents.find((a) => a.id === selectedId) || agents[0];

  return (
    <div className="relative h-full min-h-0 overflow-hidden rounded-[28px] bg-[#d9cbb8]">
      <SceneRoot className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-0 rounded-[28px] shadow-[inset_0_0_90px_rgba(28,24,20,0.22)]" />
      <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 sm:left-4 sm:top-4">
        <button type="button" onClick={closeStage} className="btn shadow-sm">
          Floor
        </button>
        {stageMode === "desk" ? (
          <button type="button" onClick={openOffice} className="btn shadow-sm">
            Office
          </button>
        ) : (
          agent && (
            <button type="button" onClick={() => openDesk(agent.id)} className="btn shadow-sm">
              {agent.name}&rsquo;s desk
            </button>
          )
        )}
      </div>
      <p className="pointer-events-none absolute inset-x-4 bottom-3 text-xs text-[var(--ink-soft)]">
        Drag to look · right-drag or WASD to move · scroll to zoom
      </p>
    </div>
  );
}
