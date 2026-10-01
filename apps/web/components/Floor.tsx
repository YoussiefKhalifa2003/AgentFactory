"use client";

import dynamic from "next/dynamic";
import { useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Bay } from "./Bay";
import { CrewStrip } from "./CrewStrip";
import { isWorking } from "@/lib/status";

const Diorama = dynamic(() => import("./scene/Diorama").then((m) => m.Diorama), { ssr: false });

export function Floor({ matchStrength = null }: { matchStrength?: Strength | null }) {
  const { agents, live, selectedId, openOffice, openDesk, quality, offline, booted } = useFactory();
  const working = agents.filter((a) => isWorking(live[a.id]?.job?.status));
  const ordered = [...agents].sort((a, b) => {
    const aw = isWorking(live[a.id]?.job?.status) ? 0 : 1;
    const bw = isWorking(live[b.id]?.job?.status) ? 0 : 1;
    return aw - bw;
  });
  const selected = agents.find((a) => a.id === selectedId);

  if (booted && offline && agents.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-[28px] bg-white/40 p-8 text-center">
        <p className="display text-2xl">Can’t reach the API</p>
        <p className="mt-2 max-w-sm text-sm text-[var(--ink-soft)]">The factory on port 8000 is offline.</p>
        <button type="button" className="btn btn-solid mt-5" onClick={() => window.location.reload()}>
          Retry
        </button>
      </div>
    );
  }

  if (booted && agents.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-[28px] bg-white/40 p-8 text-center">
        <p className="display text-3xl">Empty floor</p>
        <p className="mt-2 max-w-sm text-sm text-[var(--ink-soft)]">
          Forge an agent, then drop a list item on their desk.
        </p>
        <a href="/forge" className="btn btn-solid mt-5">
          New agent
        </a>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto rounded-[28px] bg-white/40 p-4">
      <button
        type="button"
        onClick={() => openOffice()}
        className="mb-3 block h-[13.5rem] w-full overflow-hidden rounded-[22px] bg-[#d9cbb8] text-left ring-1 ring-black/[0.04]"
        aria-label="Open the office"
      >
        {quality === "off" ? (
          <div className="flex h-full items-end justify-between px-4 py-3">
            <span className="display text-[1.35rem]">Office</span>
            {working.length > 0 && <span className="text-xs text-[var(--ink-soft)]">{working.length} working</span>}
          </div>
        ) : (
          <Diorama />
        )}
      </button>
      <div className="mb-3 flex items-center gap-2">
        <p className="display text-[1.35rem] leading-none">Floor</p>
        {selected && (
          <button type="button" onClick={() => openDesk(selected.id)} className="btn btn-compact ml-auto">
            {selected.name}&rsquo;s desk
          </button>
        )}
      </div>
      <CrewStrip />
      <div className="grid auto-rows-fr items-stretch gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ordered.map((agent) => (
          <Bay
            key={agent.id}
            agent={agent}
            highlighted={Boolean(matchStrength && agent.strengths.includes(matchStrength))}
          />
        ))}
      </div>
    </div>
  );
}
