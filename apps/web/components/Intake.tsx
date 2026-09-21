"use client";

import { FormEvent, useState } from "react";
import { useFactory } from "@/lib/factory";

export function Intake() {
  const { agents, selectedId, select, submitJob } = useFactory();
  const [prompt, setPrompt] = useState("");
  const agentId = selectedId || agents[0]?.id || "";

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!agentId || !prompt.trim()) return;
    submitJob(agentId, prompt.trim());
    setPrompt("");
  }

  return (
    <form onSubmit={onSubmit} className="glass flex shrink-0 items-center gap-2 rounded-full px-3 py-2">
      <input
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Assign work to a bay…"
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-sm outline-none"
      />
      <select
        value={agentId}
        onChange={(e) => select(e.target.value)}
        className="rounded-full bg-white/70 px-3 py-1.5 text-sm"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-solid">
        Assign
      </button>
    </form>
  );
}
