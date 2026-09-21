"use client";

import { useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Bay } from "./Bay";

export function Floor({ matchStrength = null }: { matchStrength?: Strength | null }) {
  const { agents } = useFactory();
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
