"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "@/lib/config";
import { useFactory } from "@/lib/factory";

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const { apiBase, token, sameOrigin, saveConnection, connected, netHint, shift } = useFactory();
  const [url, setUrl] = useState(apiBase);
  const [tok, setTok] = useState(token);
  const [saved, setSaved] = useState(false);
  const [probe, setProbe] = useState("");

  useEffect(() => {
    setUrl(apiBase);
    setTok(token);
  }, [apiBase, token]);

  function save(e: FormEvent) {
    e.preventDefault();
    saveConnection(sameOrigin ? apiBase : url, tok);
    setSaved(true);
  }

  async function test() {
    setProbe("Checking…");
    const t0 = performance.now();
    try {
      const r = await apiFetch("/api/health?ping=1");
      const ms = Math.round(performance.now() - t0);
      if (r.status === 401) {
        setProbe(`API reached in ${ms} ms, but the token was rejected.`);
        return;
      }
      if (!r.ok) {
        setProbe(`API answered ${r.status} in ${ms} ms.`);
        return;
      }
      setProbe(`Reachable in ${ms} ms.`);
    } catch {
      setProbe(
        typeof navigator !== "undefined" && navigator.onLine === false
          ? "This phone is offline."
          : "Unreachable. Check Tailscale and that the PC is awake."
      );
    }
  }

  const night =
    shift?.open || (shift && shift.ended_at === null && shift.started_at)
      ? `Night shift on${shift?.started_at ? ` since ${new Date(shift.started_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}.`
      : "Night shift off.";

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-[rgba(28,24,20,0.35)]" onClick={onClose}>
      <form className="sheet max-h-[88dvh] overflow-y-auto px-5 pt-4" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[rgba(28,24,20,0.12)]" />
        <p className="display text-2xl">Connection</p>
        <p className="mt-2 text-sm leading-5 text-[var(--ink-soft)]">
          {connected
            ? "Live with the factory PC."
            : netHint === "phone"
              ? "This phone is offline."
              : "Can’t reach the PC. Confirm Tailscale is on both devices, and the PC is awake."}
        </p>
        <p className="mt-2 text-[13px] text-[var(--ink-soft)]">{night}</p>

        <label className="mt-5 block text-[12px] uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Factory URL
        </label>
        {sameOrigin ? (
          <p className="mt-1 min-h-11 rounded-2xl bg-white px-4 py-3 text-[15px] break-all">{apiBase || "This page"}</p>
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-pc.ts.net"
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-1 min-h-11 w-full rounded-2xl bg-white px-4 text-[16px]"
          />
        )}

        <label className="mt-4 block text-[12px] uppercase tracking-[0.14em] text-[var(--ink-soft)]">
          Token (optional)
        </label>
        <input
          value={tok}
          onChange={(e) => setTok(e.target.value)}
          placeholder="If you set FOUNDRY_TOKEN"
          autoCapitalize="none"
          autoCorrect="off"
          className="mt-1 min-h-11 w-full rounded-2xl bg-white px-4 text-[16px]"
        />

        {saved && <p className="mt-3 text-sm">Saved. Reconnecting…</p>}
        {probe && <p className="mt-3 text-sm">{probe}</p>}

        <button type="button" className="btn mt-4 w-full" onClick={test}>
          Connection test
        </button>

        <div className="mt-3 flex gap-2">
          <button type="button" className="btn flex-1" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="btn btn-solid flex-1">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
