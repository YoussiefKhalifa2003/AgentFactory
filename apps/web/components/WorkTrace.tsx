"use client";

import { TraceEvent } from "@/lib/types";

export function WorkTrace({
  events,
  startedAt,
  tokens,
  model,
}: {
  events: TraceEvent[];
  startedAt?: string;
  tokens?: number;
  model?: string;
}) {
  const elapsed = startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
    : 0;
  const tps = elapsed > 0 && tokens ? Math.round((tokens / elapsed) * 10) / 10 : 0;

  if (!events.length) {
    return (
      <p className="font-mono text-[11px] text-[var(--ink-soft)]">
        {model ? `${model} · ` : ""}
        {elapsed ? `${elapsed}s` : "waiting"}
      </p>
    );
  }

  return (
    <ol className="space-y-1 font-mono text-[11px] text-[var(--ink-soft)]">
      {events.map((ev, i) => (
        <li key={ev.id ?? i} className="flex gap-2">
          <span className="w-14 shrink-0 tabular-nums">{((ev.duration_ms || 0) / 1000).toFixed(1)}s</span>
          <span className="truncate">
            {ev.label || ev.kind}
            {ev.detail ? ` · ${ev.detail}` : ""}
          </span>
        </li>
      ))}
      <li className="pt-1 text-[var(--ink)]">
        {elapsed}s elapsed{tps ? ` · ${tps} tok/s` : ""}
        {model ? ` · ${model}` : ""}
      </li>
    </ol>
  );
}
