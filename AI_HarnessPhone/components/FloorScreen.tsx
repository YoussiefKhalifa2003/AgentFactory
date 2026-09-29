"use client";

import { useState } from "react";
import { useFactory } from "@/lib/factory";
import { Agent, bayCopy, portrait, statusLabel, strengthLabel } from "@/lib/types";
import { PlantDots, ShiftSheet } from "./PlantDots";

function isWorking(status?: string) {
  return ["queued", "thinking", "tool"].includes(status || "");
}

export function FloorScreen({ onSettings }: { onSettings: () => void }) {
  const { agents, live, chains, connected, select, selectedId } = useFactory();
  const [shiftOpen, setShiftOpen] = useState(false);

  if (!connected && agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="display text-2xl">No floor yet</p>
        <p className="mt-2 text-[15px] leading-5 text-[var(--ink-soft)]">
          Connect to the PC, then forge agents on desktop.
        </p>
        <button type="button" className="btn mt-5" onClick={onSettings}>
          Connection
        </button>
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="display text-2xl">Empty floor</p>
        <p className="mt-2 text-[15px] leading-5 text-[var(--ink-soft)]">
          Forge agents on the desktop — they appear here live.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between px-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">Plant</p>
        <PlantDots onOpen={() => setShiftOpen(true)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="grid auto-rows-fr grid-cols-2 items-stretch gap-2.5">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              selected={selectedId === agent.id}
              liveNow={isWorking(live[agent.id]?.job?.status)}
              caption={cardCaption(
                live[agent.id]?.job?.status,
                live[agent.id]?.job?.caption,
                live[agent.id]?.job?.activity
              )}
              step={
                isWorking(live[agent.id]?.job?.status)
                  ? stepLabel(live[agent.id]?.job?.chain_id, live[agent.id]?.job?.chain_step_id, chains)
                  : ""
              }
              onOpen={() => select(agent.id)}
            />
          ))}
        </div>
      </div>
      {shiftOpen && <ShiftSheet onClose={() => setShiftOpen(false)} />}
    </div>
  );
}

function cardCaption(status?: string, caption?: string, activity?: string) {
  if (isWorking(status) && caption) return caption;
  return statusLabel(activity, status);
}

function stepLabel(
  chainId: string | null | undefined,
  stepId: string | null | undefined,
  chains: Record<string, { status?: string; steps: { id: string; seq: number }[] }>
) {
  if (!chainId) return "";
  const chain = chains[chainId];
  if (!chain?.steps?.length) return "";
  if (chain.status === "done" || chain.status === "cancelled" || chain.status === "blocked") return "";
  const step = chain.steps.find((s) => s.id === stepId);
  return step ? `${step.seq}/${chain.steps.length}` : "";
}

function AgentCard({
  agent,
  selected,
  liveNow,
  caption,
  step,
  onOpen,
}: {
  agent: Agent;
  selected: boolean;
  liveNow: boolean;
  caption: string;
  step: string;
  onOpen: () => void;
}) {
  const copy = bayCopy(agent);
  const chipIds = (agent.strengths || []).slice(0, 2);
  return (
    <button
      type="button"
      className={`bay tap w-full bg-white p-3 text-left ${liveNow ? "is-live" : ""} ${selected ? "is-selected" : ""}`}
      style={{ ["--pigment" as string]: agent.pigment }}
      onClick={onOpen}
    >
      {liveNow && (
        <span
          className="halo absolute right-2.5 top-2.5 h-2 w-2 rounded-full"
          style={{ background: agent.pigment }}
        />
      )}
      <div className="relative z-[1] flex min-w-0 items-center gap-2">
        <img src={portrait(agent)} alt="" className="h-9 w-9 shrink-0 rounded-[11px] object-cover" />
        <div className="min-w-0 flex-1">
          <p className="display truncate text-[1.05rem] leading-tight" style={{ color: agent.pigment }}>
            {agent.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-[var(--ink-soft)]">
            {caption}
            {step ? ` · ${step}` : ""}
          </p>
        </div>
      </div>
      {copy ? (
        <p className="relative z-[1] mt-2.5 line-clamp-3 text-[12px] leading-4 text-[var(--ink-soft)]">{copy}</p>
      ) : null}
      {chipIds.length > 0 && (
        <div className={`relative z-[1] flex flex-wrap gap-1 ${copy ? "mt-2" : "mt-2.5"}`}>
          {chipIds.map((id) => (
            <span
              key={id}
              className="max-w-full truncate rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_70%,white)] px-2 py-0.5 text-[10px] text-[var(--ink-soft)]"
            >
              {strengthLabel(id)}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
