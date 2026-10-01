"use client";

import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import { useRouter } from "next/navigation";
import { useFactory } from "@/lib/factory";
import { pickBestAgent } from "@/lib/tasks";
import { API_URL } from "@/lib/types";

export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    agents,
    jobs,
    assignWork,
    select,
    openOffice,
    closeStage,
    setInsightsOpen,
    setGalleryOpen,
    shift,
  } = useFactory();
  const router = useRouter();
  const [query, setQuery] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
      }
      if (e.key === "Escape") setPaletteOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPaletteOpen]);

  const results = useMemo(
    () =>
      jobs
        .filter((j) => j.status === "done" && (j.artifacts || []).length)
        .slice(0, 8),
    [jobs]
  );

  if (!paletteOpen) return null;

  return (
    <div className="modal-scrim z-[500]" onClick={() => setPaletteOpen(false)}>
      <Command
        className="paper-card w-[min(92vw,560px)] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        label="Command palette"
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Assign a task, jump to a desk…"
          className="w-full border-0 bg-transparent px-5 py-4 text-sm outline-none"
        />
        <Command.List className="max-h-80 overflow-auto px-2 pb-3">
          <Command.Empty className="px-3 py-4 text-sm text-[var(--ink-soft)]">Nothing matches.</Command.Empty>
          <Command.Group heading="Assign">
            {agents.map((agent) => (
              <Command.Item
                key={agent.id}
                value={`assign ${agent.name}`}
                className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
                onSelect={() => {
                  const text = query.replace(/^assign\s+/i, "").trim();
                  if (text) assignWork({ agentId: agent.id, text, listId: "inbox" }).catch(() => undefined);
                  select(agent.id);
                  setPaletteOpen(false);
                }}
              >
                Hand to {agent.name}
              </Command.Item>
            ))}
            <Command.Item
              value="assign best"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={() => {
                const text = query.trim();
                const best = pickBestAgent(agents, "planning");
                if (text && best) assignWork({ agentId: best.id, text, listId: "inbox" }).catch(() => undefined);
                setPaletteOpen(false);
              }}
            >
              Assign to best-fit desk
            </Command.Item>
          </Command.Group>
          <Command.Group heading="Desks">
            {agents.map((agent) => (
              <Command.Item
                key={`go-${agent.id}`}
                value={`desk ${agent.name}`}
                className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
                onSelect={() => {
                  select(agent.id);
                  closeStage();
                  setPaletteOpen(false);
                }}
              >
                {agent.name}
              </Command.Item>
            ))}
          </Command.Group>
          <Command.Group heading="Workspace">
            <Command.Item
              value="office"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={() => {
                openOffice();
                setPaletteOpen(false);
              }}
            >
              Open office
            </Command.Item>
            <Command.Item
              value="new agent forge"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={() => {
                router.push("/forge");
                setPaletteOpen(false);
              }}
            >
              New agent
            </Command.Item>
            <Command.Item
              value="insights"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={() => {
                setInsightsOpen(true);
                setPaletteOpen(false);
              }}
            >
              Insights
            </Command.Item>
            <Command.Item
              value="results gallery"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={() => {
                setGalleryOpen(true);
                setPaletteOpen(false);
              }}
            >
              Results
            </Command.Item>
            <Command.Item
              value="night shift"
              className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
              onSelect={async () => {
                const open = Boolean(shift?.open || shift?.ended_at === null);
                await fetch(`${API_URL}/api/shift/${open ? "stop" : "start"}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ cap: 8 }),
                });
                setPaletteOpen(false);
              }}
            >
              {shift?.open ? "Stop night shift" : "Start night shift"}
            </Command.Item>
          </Command.Group>
          {results.length > 0 && (
            <Command.Group heading="Recent results">
              {results.map((job) => (
                <Command.Item
                  key={job.id}
                  value={`result ${job.prompt}`}
                  className="cursor-pointer rounded-xl px-3 py-2 text-sm data-[selected=true]:bg-[var(--paper-deep)]"
                  onSelect={() => {
                    const file = job.artifacts?.[0];
                    select(job.agent_id);
                    if (file) {
                      /* gallery handles view */
                    }
                    setGalleryOpen(true);
                    setPaletteOpen(false);
                  }}
                >
                  {job.prompt.slice(0, 72)}
                </Command.Item>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}
