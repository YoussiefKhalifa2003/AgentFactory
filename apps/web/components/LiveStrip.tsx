"use client";

import { useEffect, useState } from "react";
import { API_URL, PlantSnapshot, ShiftNote } from "@/lib/types";
import { useFactory } from "@/lib/factory";

function Dot({
  label,
  on,
  busy,
  title,
}: {
  label: string;
  on: boolean;
  busy: boolean;
  title: string;
}) {
  const color = !on ? "#b42318" : busy ? "#2f7d4a" : "rgba(28,24,20,0.28)";
  return (
    <span className="flex items-center gap-1" title={title}>
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="hidden text-[11px] text-[var(--ink-soft)] xl:inline">{label}</span>
    </span>
  );
}

export function PlantDots() {
  const { plant, shift } = useFactory();
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
      /* shift lands in Wave E */
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
      setOpen(false);
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
      setOpen(false);
    }
  }

  const snap: PlantSnapshot | null = plant;
  const localBusy = Boolean(snap?.local?.busy || snap?.local?.locked);
  const spark1Busy = Boolean(snap?.spark1?.busy);
  const spark2Busy = Boolean(snap?.spark2?.busy);
  const cloudBusy = Boolean(snap?.cloud?.busy || (snap?.cloud?.inFlight || 0) > 0);
  const spark2Title = snap?.spark2?.ok
    ? spark2Busy
      ? `Spark 2 · ${snap.spark2.agentName || "busy"}`
      : "Spark 2"
    : `Spark 2 · ${snap?.spark2?.reason || "offline"}`;

  return (
    <div className="relative flex items-center gap-3">
      <button
        type="button"
        className="flex items-center gap-3"
        onClick={() => {
          setOpen((v) => !v);
          loadLatest();
        }}
        aria-label="Plant and night shift"
      >
        <Dot
          label="This PC"
          on={Boolean(snap?.local?.ok ?? true)}
          busy={localBusy}
          title={localBusy ? `This PC · ${snap?.local?.agentName || "busy"}` : "This PC"}
        />
        <Dot
          label="Spark 1"
          on={Boolean(snap?.spark1?.ok)}
          busy={spark1Busy}
          title={spark1Busy ? `Spark 1 · ${snap?.spark1?.agentName || "busy"}` : "Spark 1"}
        />
        <Dot label="Spark 2" on={Boolean(snap?.spark2?.ok)} busy={spark2Busy} title={spark2Title} />
        <Dot
          label="Cloud"
          on={Boolean(snap?.cloud?.ok)}
          busy={cloudBusy}
          title={cloudBusy ? `Cloud · ${snap?.cloud?.inFlight || 1} job` : "Cloud"}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 w-64 rounded-2xl bg-white p-3 text-left shadow-lg">
          <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Night shift</p>
          {latest?.ended_at === null || latest?.open ? (
            <button type="button" className="btn mt-2 w-full py-1 text-xs" disabled={busy} onClick={stopShift}>
              Stop night shift
            </button>
          ) : (
            <button type="button" className="btn btn-solid mt-2 w-full py-1 text-xs" disabled={busy} onClick={startShift}>
              Start night shift
            </button>
          )}
          {(note || latest?.note) && (
            <p className="mt-2 max-h-32 overflow-auto text-xs text-[var(--ink-soft)]">{note || latest?.note}</p>
          )}
        </div>
      )}
    </div>
  );
}

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
      <PlantDots />
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
