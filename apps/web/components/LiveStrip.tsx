"use client";

import { useFactory } from "@/lib/factory";

export function LiveStrip() {
  const { agents, live, connected, selectedId } = useFactory();
  const working = agents
    .map((a) => {
      const job = live[a.id]?.job;
      if (!job) return null;
      if (["done", "idle", "blocked"].includes(job.status || "idle")) return null;
      return `${a.name}: ${job.caption || "Working"}`;
    })
    .filter(Boolean) as string[];
  const selected = agents.find((a) => a.id === selectedId);
  const selectedCap =
    !working.length && selected
      ? live[selected.id]?.job?.caption === "Done"
        ? `${selected.name}: Done`
        : null
      : null;

  return (
    <div className="glass flex items-center gap-4 rounded-full px-4 py-2">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: connected ? "#3d8b5f" : "#b42318" }}
      />
      <div className="live-strip flex-1 text-sm text-[var(--ink-soft)]">
        {working.length > 0 ? (
          working.map((c) => (
            <span key={c} className="whitespace-nowrap">
              {c}
            </span>
          ))
        ) : (
          <span>{selectedCap || "Floor is quiet. Send a job."}</span>
        )}
      </div>
    </div>
  );
}
