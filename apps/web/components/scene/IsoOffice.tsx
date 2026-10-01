"use client";

import { Agent } from "@/lib/types";
import { lookSvg, parseLook } from "@/lib/look";

export function IsoOffice({ agents }: { agents: Agent[] }) {
  const cols = agents.length <= 1 ? 1 : agents.length <= 4 ? 2 : 3;
  return (
    <svg viewBox="0 0 640 220" className="h-full w-full" aria-hidden>
      <rect width="640" height="220" fill="#d9cbb8" />
      {agents.slice(0, 8).map((agent, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 70 + col * 180 + row * 20;
        const y = 40 + row * 70;
        const src = lookSvg(parseLook(agent.look, agent.name, agent.pigment), agent.pigment, 64);
        return (
          <g key={agent.id} transform={`translate(${x} ${y})`}>
            <ellipse cx="40" cy="78" rx="36" ry="10" fill="rgba(28,24,20,0.12)" />
            <rect x="8" y="48" width="64" height="28" rx="6" fill="#cbb087" />
            <image href={src} x="18" y="8" width="44" height="44" />
            <text x="40" y="92" textAnchor="middle" fontSize="11" fill="#1c1814">
              {agent.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
