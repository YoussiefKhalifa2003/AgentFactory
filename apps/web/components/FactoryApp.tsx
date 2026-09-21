"use client";

import { useState } from "react";
import { FactoryProvider, useFactory } from "@/lib/factory";
import { Strength } from "@/lib/types";
import { Floor } from "./Floor";
import { Inspector } from "./Inspector";
import { ListsSidebar } from "./MeetingsDock";
import { Stage } from "./Stage";

function Shell() {
  const { stageOpen, agents, live } = useFactory();
  const [dragStrength, setDragStrength] = useState<Strength | null>(null);
  const working = agents.filter((a) => {
    const status = live[a.id]?.job?.status;
    return Boolean(status && !["done", "idle", "blocked"].includes(status));
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
    <div className="flex h-dvh min-h-0 gap-3 overflow-hidden px-5 py-4">
      {!stageOpen && <ListsSidebar onDragStrength={setDragStrength} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex h-12 shrink-0 items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-[1.65rem] font-semibold tracking-tight">
              {stageOpen ? "Stage" : "Workspace"}
            </h1>
            {workingLabel && (
              <span className="text-sm text-[var(--ink-soft)]">{workingLabel}</span>
            )}
          </div>
          <a href="/forge" className="btn btn-solid">
            New agent
          </a>
        </header>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(300px,0.9fr)] gap-3 overflow-hidden [&>*]:h-full [&>*]:min-h-0">
          {stageOpen ? <Stage /> : <Floor matchStrength={dragStrength} />}
          <Inspector compact={stageOpen} />
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
