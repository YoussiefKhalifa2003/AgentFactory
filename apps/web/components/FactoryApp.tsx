"use client";

import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { FactoryProvider, useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Floor } from "./Floor";
import { Inspector, FilePreview } from "./Inspector";
import { PlantPanel } from "./PlantPanel";
import { ListsSidebar } from "./MeetingsDock";
import { Stage } from "./Stage";
import { SegmentedControl } from "./ui/SegmentedControl";
import { Kbd } from "./ui";
import { ToastHost } from "./ui/Toast";
import { CommandPalette } from "./CommandPalette";
import { Insights } from "./Insights";
import { ResultsGallery } from "./ResultsGallery";
import { BrainOverlay } from "./BrainOverlay";
import { parseVoiceCommand, resolveMeetingListId, speechAvailable, startListen } from "@/lib/voice";
import { pickBestAgent } from "@/lib/tasks";
import { API_URL } from "@/lib/types";

function Shell() {
  const {
    stageOpen,
    stageMode,
    agents,
    selectedId,
    connected,
    booted,
    offline,
    openOffice,
    openDesk,
    closeStage,
    preview,
    closePreview,
    setPaletteOpen,
    setInsightsOpen,
    setGalleryOpen,
    setBrainOpen,
    plant,
    quality,
    setQuality,
    assignWork,
    live,
  } = useFactory();
  const [dragStrength, setDragStrength] = useState<Strength | null>(null);
  const [pane, setPane] = useState<"lists" | "floor" | "desk">("floor");
  const [listening, setListening] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const selected = agents.find((a) => a.id === selectedId) || agents[0];
  const view = stageOpen ? (stageMode === "desk" ? "desk3d" : "office") : "floor";

  useEffect(() => {
    if (plant?.local?.busy && quality === "high") setQuality("medium");
  }, [plant?.local?.busy, quality, setQuality]);

  useEffect(() => {
    setVoiceOn(speechAvailable());
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  return (
    <div className="flex h-dvh min-h-0 gap-3 overflow-hidden px-3 py-3 sm:px-4 sm:py-3">
      <div
        className={`${pane === "lists" ? "flex" : "hidden"} min-h-0 w-full shrink-0 md:flex md:w-[18rem] lg:w-[20rem] ${
          stageOpen ? "lg:hidden" : ""
        }`}
      >
        <ListsSidebar onDragStrength={setDragStrength} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
        <header className="flex h-11 shrink-0 flex-nowrap items-center justify-between gap-2 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: connected ? "var(--live)" : "var(--alert)" }}
              title={connected ? "Connected" : "Reconnecting"}
            />
            <h1 className="display truncate text-[1.55rem] leading-none">Workspace</h1>
            <div className="hidden sm:block">
              <SegmentedControl
                ariaLabel="View"
                value={view}
                onChange={(next) => {
                  if (next === "floor") closeStage();
                  if (next === "office") {
                    openOffice();
                    setPane("floor");
                  }
                  if (next === "desk3d") {
                    if (selected) openDesk(selected.id);
                    setPane("floor");
                  }
                }}
                options={[
                  { id: "floor", label: "Floor" },
                  { id: "office", label: "Office" },
                  { id: "desk3d", label: "Desk" },
                ]}
              />
            </div>
          </div>
          <div className="flex shrink-0 flex-nowrap items-center gap-1.5 sm:gap-2">
            {voiceOn && (
              <button
                type="button"
                className={`btn btn-compact ${listening ? "btn-solid" : ""}`}
                aria-label="Hold to talk"
                onPointerDown={() => {
                  setListening(true);
                  startListen({
                    onFinal: (text) => {
                      const intent = parseVoiceCommand(text, agents);
                      if (intent.action === "cancel") {
                        const target = intent.agentName
                          ? agents.find((a) => a.name.toLowerCase() === intent.agentName.toLowerCase())
                          : agents.find((a) => a.id === selectedId);
                        const job = target ? live[target.id]?.job : null;
                        if (job?.id) fetch(`${API_URL}/api/jobs/${job.id}/cancel`, { method: "POST" });
                        return;
                      }
                      if (intent.action === "assign" && intent.text) {
                        const best = intent.agentId
                          ? agents.find((a) => a.id === intent.agentId)
                          : pickBestAgent(agents, "coding");
                        resolveMeetingListId(API_URL, intent.meeting).then((listId) => {
                          if (best) assignWork({ agentId: best.id, text: intent.text, listId }).catch(() => undefined);
                        });
                      }
                    },
                    onEnd: () => setListening(false),
                  });
                }}
                onPointerUp={() => setListening(false)}
              >
                <Mic size={14} />
              </button>
            )}
            <PlantPanel />
            <button type="button" className="btn btn-compact" onClick={() => setBrainOpen(true)}>
              Brain
            </button>
            <button type="button" className="btn btn-compact" onClick={() => setInsightsOpen(true)}>
              Insights
            </button>
            <button type="button" className="btn btn-compact" onClick={() => setGalleryOpen(true)}>
              Results
            </button>
            <button type="button" className="btn btn-compact hidden md:inline-flex" onClick={() => setPaletteOpen(true)}>
              <Kbd>Ctrl K</Kbd>
            </button>
            {!stageOpen && (
              <a href="/forge" className="btn btn-solid shrink-0">
                New agent
              </a>
            )}
          </div>
        </header>
        <div className="flex gap-2 md:hidden">
          {(["lists", "floor", "desk"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn min-h-11 px-3 py-1 text-xs ${pane === id ? "btn-solid" : ""}`}
              onClick={() => setPane(id)}
            >
              {id === "lists" ? "Lists" : id === "floor" ? "Floor" : "Desk"}
            </button>
          ))}
        </div>
        <div className="hidden gap-2 md:flex lg:hidden">
          {(["floor", "desk"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn min-h-11 px-3 py-1 text-xs ${pane === id ? "btn-solid" : ""}`}
              onClick={() => setPane(id)}
            >
              {id === "floor" ? "Floor" : "Desk"}
            </button>
          ))}
        </div>
        {!booted && <p className="text-sm text-[var(--ink-soft)]">Opening…</p>}
        {booted && offline && agents.length === 0 && (
          <p className="text-sm text-[var(--alert)]">Can’t reach the API on port 8000.</p>
        )}
        <div
          className={`grid min-h-0 flex-1 gap-3 overflow-hidden [&>*]:h-full [&>*]:min-h-0 ${
            stageOpen
              ? "lg:grid-cols-[minmax(0,2.2fr)_minmax(240px,0.65fr)]"
              : "md:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.85fr)] lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.85fr)]"
          }`}
        >
          <div
            className={`${pane === "floor" ? "min-h-0" : "hidden"} ${
              pane !== "desk" ? "md:block" : "md:hidden"
            } lg:block`}
          >
            {stageOpen ? <Stage /> : <Floor matchStrength={dragStrength} />}
          </div>
          <div className={`${pane === "desk" ? "min-h-0" : "hidden"} lg:block`}>
            <Inspector compact={stageOpen} />
          </div>
        </div>
      </div>
      {preview && <FilePreview jobId={preview.jobId} file={preview.file} onClose={closePreview} />}
      <CommandPalette />
      <BrainOverlay />
      <Insights />
      <ResultsGallery />
      <ToastHost />
    </div>
  );
}

export function FactoryApp() {
  return (
    <FactoryProvider>
      <Shell />
    </FactoryProvider>
  );
}
