"use client";

import { useState } from "react";
import { useFactory } from "@/lib/factory";
import { ListsScreen } from "./ListsScreen";
import { FloorScreen } from "./FloorScreen";
import { DeskScreen } from "./DeskScreen";
import { SettingsSheet } from "./SettingsSheet";
import { FilePreview } from "./Preview";
import { Artifact } from "@/lib/types";

export function Shell() {
  const { tab, setTab, connected, booted, netHint, agents } = useFactory();
  const [settings, setSettings] = useState(false);
  const [preview, setPreview] = useState<{ jobId: string; file: Artifact } | null>(null);

  return (
    <div
      className="flex h-dvh min-h-0 flex-col overflow-hidden"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: connected ? "var(--live)" : "var(--alert)" }}
          />
          <h1 className="display truncate text-[1.45rem] leading-none">Workspace</h1>
        </div>
        <button
          type="button"
          className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--ink-soft)]"
          aria-label="Settings"
          onClick={() => setSettings(true)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </button>
      </header>

      {!connected && booted && (
        <div className="mx-4 mb-2 rounded-2xl bg-white px-3 py-2.5 text-sm">
          <p className="font-medium">{netHint === "phone" ? "Can’t reach the PC" : "Reconnecting…"}</p>
          <p className="mt-0.5 text-[13px] text-[var(--ink-soft)]">
            {netHint === "phone"
              ? "This phone is offline. Check cellular or Wi-Fi."
              : "The factory PC may be asleep, or Tailscale is off. Check the PC."}
          </p>
        </div>
      )}
      {booted && connected && agents.length === 0 && (
        <p className="px-4 text-sm text-[var(--ink-soft)]">No agents yet — forge one on the desktop.</p>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === "lists" && <ListsScreen onPreview={(jobId, file) => setPreview({ jobId, file })} />}
        {tab === "floor" && <FloorScreen onSettings={() => setSettings(true)} />}
        {tab === "desk" && <DeskScreen onPreview={(jobId, file) => setPreview({ jobId, file })} />}
      </div>

      <nav
        className="grid shrink-0 grid-cols-3 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--paper)_88%,white)] px-2 pt-1"
        style={{ paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))" }}
      >
        {(["lists", "floor", "desk"] as const).map((id) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            className="flex min-h-12 flex-col items-center justify-center"
            onClick={() => setTab(id)}
          >
            <span
              className={`rounded-full px-3.5 py-1.5 text-[12px] tracking-[0.12em] uppercase ${
                tab === id
                  ? "bg-[var(--ink)] font-semibold text-white"
                  : "font-medium text-[var(--ink-soft)]"
              }`}
            >
              {id === "lists" ? "Lists" : id === "floor" ? "Floor" : "Desk"}
            </span>
          </button>
        ))}
      </nav>

      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
      {preview && (
        <FilePreview jobId={preview.jobId} file={preview.file} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
