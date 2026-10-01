"use client";

import { useFactory } from "@/lib/factory";
import { portraitFor } from "@/lib/look";
import { API_URL } from "@/lib/types";
import { isWorking } from "@/lib/status";

export function CrewStrip() {
  const { chains, agents, live } = useFactory();
  const liveChains = Object.values(chains).filter(
    (c) => c.status !== "done" && c.status !== "cancelled" && c.status !== "blocked"
  );
  if (!liveChains.length) return null;

  return (
    <div className="mb-4 flex flex-col gap-2">
      {liveChains.map((chain) => (
        <div key={chain.id} className="flex items-center gap-2 overflow-x-auto rounded-[22px] bg-white/80 px-3 py-2">
          {chain.steps.map((step, i) => {
            const agent = agents.find((a) => a.id === step.agent_id);
            const job = agent ? live[agent.id]?.job : null;
            const on = job?.chain_step_id === step.id && isWorking(job?.status);
            const done = step.status === "done";
            return (
              <div key={step.id} className="flex items-center gap-2">
                {i > 0 && <span className="text-[var(--ink-faint)]">→</span>}
                <div className={`flex items-center gap-2 rounded-full px-2 py-1 ${on ? "bg-[var(--paper-deep)]" : ""}`}>
                  {agent && (
                    <img
                      src={portraitFor(agent, API_URL)}
                      alt=""
                      className="h-6 w-6 rounded-md object-cover"
                    />
                  )}
                  <span className="text-xs">
                    {agent?.name || step.strength} {done ? "✓" : on ? `· ${step.seq}/${chain.steps.length}` : ""}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
