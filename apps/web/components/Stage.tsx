"use client";

import { useFactory } from "@/lib/factory";
import { Activity } from "@/lib/types";
import { OfficeCanvas } from "./OfficeCanvas";
import { WorkerCanvas } from "./WorkerCanvas";

export function Stage() {
  const {
    agents,
    live,
    selectedId,
    stageMode,
    chains,
    showroom,
    shift,
    closeStage,
    select,
    openOffice,
    openDesk,
    openPreview,
  } = useFactory();
  const night = Boolean(shift?.open);
  const agent = agents.find((a) => a.id === selectedId) || agents[0];
  const job = agent ? live[agent.id]?.job : undefined;
  const activity = (job?.activity || "idle") as Activity;
  const feed = (live[agent?.id || ""]?.tokens || job?.output || "").trim();

  return (
    <div
      className="relative h-full min-h-0 overflow-hidden rounded-[28px]"
      style={{ background: night ? "#12100e" : "#d9cbb8" }}
    >
      {stageMode === "desk" && agent ? (
        <WorkerCanvas
          key={agent.id}
          agent={agent}
          activity={activity}
          feed={feed}
          night={night}
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <OfficeCanvas
          agents={agents}
          live={live}
          selectedId={selectedId}
          chains={chains}
          showroom={showroom}
          night={night}
          onSelect={select}
          onPreview={openPreview}
          className="absolute inset-0 h-full w-full"
        />
      )}
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
    </div>
  );
}
