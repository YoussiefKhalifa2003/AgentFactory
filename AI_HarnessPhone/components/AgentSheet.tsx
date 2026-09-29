"use client";

import { useState } from "react";
import { useFactory } from "@/lib/factory";
import { ListItem, portrait, strengthLabel } from "@/lib/types";

export function AgentSheet({
  item,
  onClose,
  onAssigned,
}: {
  item: ListItem;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const { agents, assignWork } = useFactory();
  const [mode, setMode] = useState<"one" | "crew" | "split">("one");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function toggle(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 4)));
  }

  async function go() {
    setBusy(true);
    setErr("");
    try {
      if (mode === "one") {
        if (picked.length !== 1) throw new Error("Pick one agent.");
        await assignWork({ itemId: item.id, agentId: picked[0] });
      } else if (mode === "crew") {
        if (picked.length < 2) throw new Error("Pick at least two agents.");
        const chain = picked
          .map((id) => agents.find((a) => a.id === id))
          .filter(Boolean)
          .map((agent) => ({
            agent_id: agent!.id,
            strength: agent!.strengths[0] || "ops",
          }));
        await assignWork({ itemId: item.id, chain });
      } else {
        await assignWork({ itemId: item.id, foreman: true });
      }
      onAssigned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not assign.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgba(28,24,20,0.35)]" onClick={onClose}>
      <div className="sheet max-h-[82dvh] overflow-y-auto px-4 pt-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(28,24,20,0.12)]" />
        <p className="display text-2xl">Who should take this?</p>
        <p className="mt-2 text-sm leading-5 text-[var(--ink-soft)]">{item.text}</p>

        <div className="mt-4 flex gap-1">
          {(["one", "crew", "split"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn flex-1 text-[13px] ${mode === id ? "btn-solid" : ""}`}
              onClick={() => {
                setMode(id);
                setErr("");
              }}
            >
              {id === "one" ? "One" : id === "crew" ? "Crew" : "Split"}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--ink-soft)]">
          {mode === "one"
            ? "Hand the task to a single agent."
            : mode === "crew"
              ? "Tap in order. 1st selected gets item 1, 2nd gets item 2, 3rd gets item 3."
              : "Splits a 1 / 2 / 3 list onto matching desks. First item first."}
        </p>

        {mode !== "split" && (
          <div className="mt-3 space-y-1">
            {agents.map((agent) => {
              const on = picked.includes(agent.id);
              const order = picked.indexOf(agent.id);
              return (
                <button
                  key={agent.id}
                  type="button"
                  className={`tap flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left ${
                    on ? "bg-white ring-1 ring-[var(--ink)]" : "bg-white/40"
                  }`}
                  onClick={() => {
                    if (mode === "one") setPicked([agent.id]);
                    else toggle(agent.id);
                  }}
                >
                  <img src={portrait(agent)} alt="" className="h-10 w-10 rounded-xl object-cover" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium" style={{ color: agent.pigment }}>
                      {agent.name}
                    </span>
                    <span className="block truncate text-[12px] leading-4 text-[var(--ink-soft)]">
                      {agent.description?.trim() ||
                        (agent.strengths || []).slice(0, 2).map(strengthLabel).join(" · ")}
                    </span>
                  </span>
                  {on && (
                    <span className="shrink-0 rounded-full bg-[var(--ink)] px-2 py-0.5 text-[12px] text-white">
                      {mode === "one" ? "On" : order === 0 ? "1st" : `${order + 1}`}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {err && <p className="mt-3 text-sm text-[var(--alert)]">{err}</p>}

        <div className="mt-4 flex gap-2">
          <button type="button" className="btn flex-1" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-solid flex-1" disabled={busy} onClick={go}>
            {busy ? "Sending…" : mode === "split" ? "Let the floor pick" : "Assign"}
          </button>
        </div>
      </div>
    </div>
  );
}
