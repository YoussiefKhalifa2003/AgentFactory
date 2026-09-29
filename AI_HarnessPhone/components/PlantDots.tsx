"use client";

import { useFactory } from "@/lib/factory";
import { PlantSnapshot } from "@/lib/types";

function Dot({ on, busy, title }: { on: boolean; busy: boolean; title: string }) {
  const color = !on ? "var(--alert)" : busy ? "var(--live)" : "rgba(28,24,20,0.28)";
  return (
    <span className="flex h-11 w-4 items-center justify-center" title={title}>
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
    </span>
  );
}

export function PlantDots({ onOpen }: { onOpen?: () => void }) {
  const { plant } = useFactory();
  const snap: PlantSnapshot | null = plant;
  const localBusy = Boolean(snap?.local?.busy || snap?.local?.locked);
  const spark1Busy = Boolean(snap?.spark1?.busy);
  const spark2Busy = Boolean(snap?.spark2?.busy);
  const cloudBusy = Boolean(snap?.cloud?.busy || (snap?.cloud?.inFlight || 0) > 0);

  return (
    <button
      type="button"
      className="flex h-11 items-center gap-1 px-1"
      aria-label="Plant and night shift"
      onClick={onOpen}
    >
      <Dot
        on={Boolean(snap?.local?.ok ?? true)}
        busy={localBusy}
        title={localBusy ? `This PC · ${snap?.local?.agentName || "busy"}` : "This PC"}
      />
      <Dot
        on={Boolean(snap?.spark1?.ok)}
        busy={spark1Busy}
        title={spark1Busy ? `Spark 1 · ${snap?.spark1?.agentName || "busy"}` : "Spark 1"}
      />
      <Dot
        on={Boolean(snap?.spark2?.ok)}
        busy={spark2Busy}
        title={snap?.spark2?.ok ? (spark2Busy ? `Spark 2 · ${snap.spark2.agentName || "busy"}` : "Spark 2") : `Spark 2 · ${snap?.spark2?.reason || "offline"}`}
      />
      <Dot
        on={Boolean(snap?.cloud?.ok)}
        busy={cloudBusy}
        title={cloudBusy ? `Cloud · ${snap?.cloud?.inFlight || 1} job` : "Cloud"}
      />
    </button>
  );
}

export function ShiftSheet({ onClose }: { onClose: () => void }) {
  const { shift } = useFactory();
  const open = Boolean(shift?.open || (shift && shift.ended_at === null && shift.started_at));
  const when = shift?.started_at
    ? new Date(shift.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgba(28,24,20,0.35)]" onClick={onClose}>
      <div className="sheet px-5 pt-4" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(28,24,20,0.12)]" />
        <p className="display text-2xl">Night shift</p>
        <p className="mt-2 text-sm leading-5 text-[var(--ink-soft)]">
          {open
            ? `On${when ? ` since ${when}` : ""}. Start and stop stay on the desktop.`
            : "Off. Start it from the desktop when you want the floor to keep working overnight."}
        </p>
        {(shift?.note || "").trim() ? (
          <p className="mt-3 max-h-40 overflow-auto text-sm leading-5">{shift?.note}</p>
        ) : null}
        <button type="button" className="btn mt-5 w-full" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
