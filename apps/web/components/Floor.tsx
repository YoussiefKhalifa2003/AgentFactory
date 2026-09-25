"use client";

import { useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Bay } from "./Bay";

export function Floor({ matchStrength = null }: { matchStrength?: Strength | null }) {
  const { agents, showroom, select, openPreview, refreshShowroom } = useFactory();
  const cards = showroom.filter((pin) => pin.artifact);
  return (
    <div className="h-full min-h-0 overflow-auto rounded-[28px] bg-white/45 p-5">
      <div className="grid h-full auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((agent) => (
          <Bay
            key={agent.id}
            agent={agent}
            highlighted={Boolean(matchStrength && agent.strengths.includes(matchStrength))}
          />
        ))}
      </div>
      {cards.length > 0 && (
        <div className="mt-6">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">
            Showroom
          </p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((pin) => (
              <button
                key={pin.id}
                type="button"
                className="rounded-[24px] bg-white p-4 text-left shadow-sm"
                onClick={() => {
                  select(pin.agent_id);
                  if (pin.artifact) openPreview(pin.job_id, pin.artifact);
                  refreshShowroom();
                }}
              >
                <p className="truncate text-sm font-medium">{pin.artifact?.name}</p>
                <p className="mt-1 truncate text-[11px] text-[var(--ink-soft)]">
                  {pin.agent_name}
                  {pin.project_title ? ` · ${pin.project_title}` : ""}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
      {agents.length === 0 && (
        <div className="flex h-full min-h-[240px] items-center justify-center">
          <p className="max-w-sm text-center text-[var(--ink-soft)]">
            No desks yet. Forge an agent and hand it a list.
          </p>
        </div>
      )}
    </div>
  );
}
