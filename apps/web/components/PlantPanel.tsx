"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { API_URL, PlantSnapshot, PlantSlot, ShiftNote } from "@/lib/types";
import { useFactory } from "@/lib/factory";
import { Meter } from "./ui";

function SlotRow({
  label,
  slot,
}: {
  label: string;
  slot?: PlantSlot | null;
}) {
  const on = Boolean(slot?.ok ?? (label === "This PC"));
  const busy = Boolean(slot?.busy || slot?.locked || (slot?.inFlight || 0) > 0);
  const status = !on ? "Offline" : busy ? "Busy" : "Ready";
  const detail = !on
    ? slot?.reason || "offline"
    : busy
      ? `${slot?.agentName || "a desk"} · ${slot?.model || slot?.jobId || "job"}`
      : "idle";
  return (
    <div className="flex items-center gap-3 py-2">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ background: !on ? "var(--alert)" : busy ? "var(--live)" : "rgba(28,24,20,0.28)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-[11px] text-[var(--ink-soft)]">
          {status} · {detail}
        </p>
      </div>
      <div className="w-16">
        <Meter value={busy ? 1 : on ? 0.12 : 0} />
      </div>
    </div>
  );
}

export function PlantPanel() {
  const { plant, shift, quality, setQuality } = useFactory();
  const [open, setOpen] = useState(false);
  const [latest, setLatest] = useState<ShiftNote | null>(shift);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    setLatest(shift);
  }, [shift]);

  async function loadLatest() {
    try {
      const r = await fetch(`${API_URL}/api/shift/latest`);
      if (!r.ok) return;
      const data = (await r.json()) as ShiftNote;
      setLatest(data);
      setNote(data.note || "");
    } catch {
      /* optional */
    }
  }

  async function startShift() {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/shift/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cap: 8 }),
      });
      if (r.ok) {
        const data = await r.json();
        setLatest(data.shift || data);
      }
    } finally {
      setBusy(false);
    }
  }

  async function stopShift() {
    setBusy(true);
    try {
      const r = await fetch(`${API_URL}/api/shift/stop`, { method: "POST" });
      if (r.ok) {
        const data = await r.json();
        setLatest(data.shift || data);
        setNote((data.shift || data).note || "");
      }
    } finally {
      setBusy(false);
    }
  }

  const snap: PlantSnapshot | null = plant;
  const night = Boolean(latest?.ended_at === null || latest?.open);
  const busyCount = [
    snap?.local?.busy,
    snap?.spark1?.busy,
    snap?.spark2?.busy,
    snap?.cloud?.busy || (snap?.cloud?.inFlight || 0) > 0,
  ].filter(Boolean).length;

  return (
    <div className="relative">
      <button
        type="button"
        className="btn btn-compact"
        onClick={() => {
          setOpen((v) => !v);
          loadLatest();
        }}
        aria-expanded={open}
        aria-label="Plant status"
      >
        Plant{busyCount ? ` · ${busyCount}` : ""}
      </button>
      {open && (
        <div className="paper-card absolute right-0 top-10 z-30 w-80 p-4 text-left">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Plant</p>
          <SlotRow label="This PC" slot={snap?.local} />
          <SlotRow label="Spark 1" slot={snap?.spark1} />
          <SlotRow label="Spark 2" slot={snap?.spark2} />
          <SlotRow label="Cloud" slot={snap?.cloud || snap?.openrouter || snap?.zen} />
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Night shift</p>
            <button
              type="button"
              className={`btn btn-compact ${night ? "btn-solid" : ""}`}
              disabled={busy}
              onClick={night ? stopShift : startShift}
            >
              {night ? <Moon size={14} /> : <Sun size={14} />}
              {night ? "Stop" : "Start"}
            </button>
          </div>
          {(note || latest?.note) && (
            <p className="mt-2 max-h-28 overflow-auto text-xs text-[var(--ink-soft)]">{note || latest?.note}</p>
          )}
          <label className="mt-3 block text-xs text-[var(--ink-soft)]">
            Scene quality
            <select
              className="mt-1 w-full rounded-full bg-white px-3 py-2 text-sm text-[var(--ink)]"
              value={quality}
              onChange={(e) => setQuality(e.target.value as typeof quality)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="off">Off (2D)</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
