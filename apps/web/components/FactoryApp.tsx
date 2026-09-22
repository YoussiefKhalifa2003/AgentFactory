"use client";

import { useState } from "react";
import { FactoryProvider, useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Floor } from "./Floor";
import { Inspector } from "./Inspector";
import { ListsSidebar } from "./MeetingsDock";
import { Stage } from "./Stage";

function Shell() {
  const { stageOpen, agents, live, connected, booted, offline } = useFactory();
  const [dragStrength, setDragStrength] = useState<Strength | null>(null);
  const [pane, setPane] = useState<"lists" | "floor" | "desk">("floor");
  const working = agents.filter((a) => {
    const status = live[a.id]?.job?.status;
    return Boolean(status && !["done", "idle", "blocked", "cancelled"].includes(status));
  });
  const workingLabel =
    working.length === 0
      ? ""
      : working.length === 1
        ? `${working[0].name} is working`
        : working.length === 2
          ? `${working[0].name} and ${working[1].name} are working`
          : `${working
              .slice(0, -1)
              .map((a) => a.name)
              .join(", ")}, and ${working[working.length - 1].name} are working`;

  return (
    <div className="flex h-dvh min-h-0 gap-3 overflow-hidden px-3 py-3 sm:px-5 sm:py-4">
      <div
        className={`${pane === "lists" ? "flex" : "hidden"} min-h-0 w-full shrink-0 lg:flex lg:w-auto ${
          stageOpen ? "lg:hidden" : ""
        }`}
      >
        <ListsSidebar onDragStrength={setDragStrength} />
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex h-12 shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: connected ? "#2f7d4a" : "#b42318" }}
              title={connected ? "Connected" : "Reconnecting"}
            />
            <h1 className="truncate text-[1.65rem] font-semibold tracking-tight">
              {stageOpen ? "Stage" : "Workspace"}
            </h1>
            {workingLabel && (
              <span className="hidden truncate text-sm text-[var(--ink-soft)] sm:inline">
                {workingLabel}
              </span>
            )}
          </div>
          <a href="/forge" className="btn btn-solid shrink-0">
            New agent
          </a>
        </header>
        <div className="flex gap-2 lg:hidden">
          {(["lists", "floor", "desk"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={`btn px-3 py-1 text-xs ${pane === id ? "btn-solid" : ""}`}
              onClick={() => setPane(id)}
            >
              {id === "lists" ? "Lists" : id === "floor" ? "Floor" : "Desk"}
            </button>
          ))}
        </div>
        {!booted && <p className="text-sm text-[var(--ink-soft)]">Opening the factory…</p>}
        {booted && offline && agents.length === 0 && (
          <p className="text-sm text-[#b42318]">Can’t reach the API. Is it running on port 8000?</p>
        )}
        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.9fr)] [&>*]:h-full [&>*]:min-h-0">
          <div className={pane === "floor" ? "min-h-0" : "hidden lg:block"}>
            {stageOpen ? <Stage /> : <Floor matchStrength={dragStrength} />}
          </div>
          <div className={pane === "desk" ? "min-h-0" : "hidden lg:block"}>
            <Inspector compact={stageOpen} />
          </div>
        </div>
      </div>
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
