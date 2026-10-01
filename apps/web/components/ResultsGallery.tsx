"use client";

import { useEffect, useMemo, useState } from "react";
import { useFactory } from "@/lib/factory";
import { Artifact, Job } from "@/lib/types";
import { bestView, fileKindLabel } from "@/lib/files";
import { taskTitle } from "@/lib/tasks";
import { Modal } from "./ui/Modal";
import { portraitFor } from "@/lib/look";
import { API_URL } from "@/lib/types";

export function ResultsGallery() {
  const { galleryOpen, setGalleryOpen, jobs, agents, openPreview } = useFactory();
  const [filter, setFilter] = useState("all");
  const [cursor, setCursor] = useState(0);

  const cards = useMemo(() => {
    const rows: { job: Job; file: Artifact; agentName: string }[] = [];
    for (const job of jobs) {
      if (job.status !== "done") continue;
      const file = bestView(job.artifacts || []);
      if (!file) continue;
      if (filter !== "all" && job.agent_id !== filter && fileKindLabel(file) !== filter) continue;
      rows.push({
        job,
        file,
        agentName: agents.find((a) => a.id === job.agent_id)?.name || "Desk",
      });
    }
    return rows;
  }, [jobs, agents, filter]);

  useEffect(() => {
    if (!galleryOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setCursor((n) => Math.min(cards.length - 1, n + 1));
      if (e.key === "ArrowLeft") setCursor((n) => Math.max(0, n - 1));
      if (e.key === "Enter" && cards[cursor]) {
        const row = cards[cursor];
        openPreview(row.job.id, row.file);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [galleryOpen, cards, cursor]);

  return (
    <>
      <Modal open={galleryOpen} onClose={() => setGalleryOpen(false)} title="Results" wide>
        <div className="mb-4 flex flex-wrap gap-2">
          <button type="button" className={`btn btn-compact ${filter === "all" ? "btn-solid" : ""}`} onClick={() => setFilter("all")}>
            All
          </button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              className={`btn btn-compact ${filter === agent.id ? "btn-solid" : ""}`}
              onClick={() => setFilter(agent.id)}
            >
              {agent.name}
            </button>
          ))}
        </div>
        {cards.length === 0 ? (
          <p className="text-sm text-[var(--ink-soft)]">Finished files land here. Assign a job, then View.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((row, i) => (
              <button
                key={row.file.id}
                type="button"
                className={`paper-card p-3 text-left ${i === cursor ? "ring-2 ring-[var(--ink)]" : ""}`}
                onClick={() => {
                  setCursor(i);
                  openPreview(row.job.id, row.file);
                }}
              >
                <div className="flex items-center gap-2">
                  <img
                    src={portraitFor(agents.find((a) => a.id === row.job.agent_id) || { name: row.agentName, pigment: "#c45e32" }, API_URL)}
                    alt=""
                    className="h-8 w-8 rounded-lg object-cover"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{taskTitle({ prompt: row.job.prompt })}</p>
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      {row.agentName} · {fileKindLabel(row.file)}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </Modal>
    </>
  );
}
