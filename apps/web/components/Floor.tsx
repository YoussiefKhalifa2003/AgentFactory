"use client";

import { useFactory } from "@/lib/factory";
import { Strength, badgeDataUrl, pfpSrc } from "@/lib/types";
import { Bay } from "./Bay";

function isWorking(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

export function Floor({ matchStrength = null }: { matchStrength?: Strength | null }) {
  const { agents, live, selectedId, openOffice, openDesk } = useFactory();
  const working = agents.filter((a) => isWorking(live[a.id]?.job?.status));
  const faces = (working.length ? working : agents).slice(0, 4);
  const extra = Math.max(0, (working.length ? working : agents).length - faces.length);

  const selected = agents.find((a) => a.id === selectedId);

  return (
    <div className="h-full min-h-0 overflow-auto rounded-[28px] bg-white/40 p-4">
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => openOffice()}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-[22px] bg-white/90 px-3 py-2.5 text-left transition hover:bg-white"
        >
        {faces.length > 0 && (
          <div className="flex shrink-0 items-center">
            {faces.map((agent, i) => (
              <img
                key={agent.id}
                src={pfpSrc(agent.pfp) || badgeDataUrl(agent.name, agent.pigment)}
                alt=""
                className="h-8 w-8 rounded-xl object-cover ring-2 ring-white"
                style={{ marginLeft: i === 0 ? 0 : -8 }}
              />
            ))}
            {extra > 0 && (
              <span className="ml-1.5 text-[11px] text-[var(--ink-soft)]">+{extra}</span>
            )}
          </div>
        )}
        <span className="display text-[1.35rem] leading-none">Office</span>
        {working.length > 0 && (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#2f7d4a]" />
        )}
        </button>
        {selected && (
          <button
            type="button"
            onClick={() => openDesk(selected.id)}
            className="btn shrink-0"
          >
            Desk
          </button>
        )}
      </div>
      <div className="grid auto-rows-fr items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Bay
            key={agent.id}
            agent={agent}
            highlighted={Boolean(matchStrength && agent.strengths.includes(matchStrength))}
          />
        ))}
      </div>
      {agents.length === 0 && (
        <div className="flex min-h-[180px] items-center justify-center">
          <p className="text-sm text-[var(--ink-soft)]">Forge an agent to fill the floor.</p>
        </div>
      )}
    </div>
  );
}
