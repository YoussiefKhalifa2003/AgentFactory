"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/types";
import { useFactory } from "@/lib/factory";
import { Modal } from "./ui/Modal";
import { Meter } from "./ui";

type Stats = {
  desks: {
    id: string;
    name: string;
    pigment: string;
    jobs: number;
    done: number;
    blocked: number;
    tokens: number;
    median_s: number;
    success: number;
  }[];
  today: { id: string; agent_id: string; status: string; caption: string; at: string }[];
  totals: { jobs: number; done: number; blocked: number };
};

export function Insights() {
  const { insightsOpen, setInsightsOpen, plant } = useFactory();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!insightsOpen) return;
    fetch(`${API_URL}/api/stats`)
      .then((r) => r.json())
      .then(setStats)
      .catch(() => setStats(null));
  }, [insightsOpen]);

  return (
    <Modal open={insightsOpen} onClose={() => setInsightsOpen(false)} title="Insights" wide>
      {!stats ? (
        <p className="text-sm text-[var(--ink-soft)]">Gathering the floor…</p>
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Jobs" value={stats.totals.jobs} />
            <Stat label="Done" value={stats.totals.done} />
            <Stat label="Blocked" value={stats.totals.blocked} />
          </div>
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Desks</p>
            <div className="grid gap-2">
              {stats.desks.map((desk) => (
                <div key={desk.id} className="flex items-center gap-3 rounded-2xl bg-white/70 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: desk.pigment }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{desk.name}</p>
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      {desk.done}/{desk.jobs} done · {Math.round(desk.success * 100)}% · {desk.median_s}s median · ~
                      {desk.tokens} tokens
                    </p>
                    <Meter value={desk.success} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Plant</p>
            <p className="text-sm text-[var(--ink-soft)]">
              This PC {plant?.local?.busy ? "busy" : "ready"} · Spark 1 {plant?.spark1?.ok ? "up" : "down"} · Spark 2{" "}
              {plant?.spark2?.ok ? "up" : "down"} · Cloud {plant?.cloud?.ok ? "up" : "down"}
            </p>
          </div>
          <div>
            <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Today</p>
            <ul className="space-y-1 text-sm">
              {stats.today.length === 0 && <li className="text-[var(--ink-soft)]">Quiet so far.</li>}
              {stats.today.map((row) => (
                <li key={row.id} className="truncate">
                  {row.status} · {row.caption}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">{label}</p>
      <p className="display mt-1 text-3xl">{value}</p>
    </div>
  );
}
