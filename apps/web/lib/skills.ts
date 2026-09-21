"use client";

import { useEffect, useState } from "react";
import { API_URL, STRENGTHS, TOOLS, SkillPack } from "./types";

function mergeTools(extra: SkillPack[]) {
  const seen = new Set(TOOLS.map((row) => row.id));
  return [...TOOLS, ...extra.filter((row) => !seen.has(row.id))];
}

export function isToolSkill(id: string, tools: SkillPack[] = TOOLS) {
  return tools.some((row) => row.id === id);
}

export function splitPacks(ids: string[], tools: SkillPack[] = TOOLS) {
  const toolIds = new Set(tools.map((row) => row.id));
  return {
    domain: ids.filter((id) => !toolIds.has(id)),
    tools: ids.filter((id) => toolIds.has(id)),
  };
}

export function useSkillCatalog() {
  const [tools, setTools] = useState<SkillPack[]>(TOOLS);

  useEffect(() => {
    fetch(`${API_URL}/api/strengths`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.tools)) setTools(mergeTools(data.tools));
      })
      .catch(() => undefined);
  }, []);

  return { strengths: STRENGTHS, tools };
}
