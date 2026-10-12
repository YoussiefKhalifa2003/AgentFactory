"use client";

import { API_URL, ModelOption } from "./types";

export const FALLBACK_MODELS: ModelOption[] = [
  {
    id: "local:qwen3:14b",
    name: "Qwen3 14B",
    provider: "local",
    hint: "This machine · everyday jobs · tools",
    available: true,
    vram: "~10 GB",
  },
  {
    id: "local:qwen3.6:35b-a3b",
    name: "Qwen3.6 35B",
    provider: "local",
    hint: "This machine · MoE on a 4090 · heavier jobs",
    available: true,
    vram: "~22 GB",
  },
  {
    id: "local:qwen3-vl:8b",
    name: "Qwen3 VL 8B",
    provider: "local",
    hint: "This machine · fast · vision",
    available: true,
    vram: "~6 GB",
  },
  {
    id: "spark:qwen3.6:35b-a3b",
    name: "Qwen3.6 35B",
    provider: "spark",
    hint: "Spark · everyday jobs · tools",
    available: true,
    vram: "MoE · 32K",
  },
  {
    id: "spark:qwen3.8",
    name: "Qwen3.8 27B",
    provider: "spark",
    hint: "Spark · strongest general · tools",
    available: true,
    vram: "~17 GB",
  },
  {
    id: "spark:qwen3-vl:32b",
    name: "Qwen3 VL 32B",
    provider: "spark",
    hint: "Spark · vision · loads on demand",
    available: true,
    vram: "~20 GB",
  },
  {
    id: "spark:qwen3-vl:8b",
    name: "Qwen3 VL 8B",
    provider: "spark",
    hint: "Spark · fast vision",
    available: true,
    vram: "~6 GB",
  },
  {
    id: "openrouter:deepseek/deepseek-chat",
    name: "DeepSeek V3",
    provider: "openrouter",
    hint: "OpenRouter · strong coder",
    available: true,
  },
  {
    id: "openrouter:google/gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "openrouter",
    hint: "OpenRouter · fast general",
    available: true,
  },
  {
    id: "openrouter:openai/gpt-4o-mini",
    name: "GPT-4o mini",
    provider: "openrouter",
    hint: "OpenRouter · cheap and steady",
    available: true,
  },
  {
    id: "big-pickle",
    name: "Big Pickle",
    provider: "zen",
    hint: "OpenCode Zen · free tier",
    available: true,
  },
];

export type ModelCatalog = {
  catalog: ModelOption[];
  defaultId: string;
};

let snap: ModelCatalog = {
  catalog: FALLBACK_MODELS,
  defaultId: FALLBACK_MODELS[0].id,
};
let liveOk = false;
let inflight: Promise<ModelCatalog> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let followUp = false;
const listeners = new Set<(next: ModelCatalog) => void>();

function emit() {
  for (const fn of listeners) fn(snap);
}

export function getModelCatalog(): ModelCatalog {
  return snap;
}

export function subscribeModels(fn: (next: ModelCatalog) => void) {
  listeners.add(fn);
  fn(snap);
  return () => {
    listeners.delete(fn);
  };
}

export function warmupModels() {
  void loadModels();
}

function scheduleRetry() {
  if (retryTimer || liveOk) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void loadModels(true);
  }, 2500);
}

export async function loadModels(force = false): Promise<ModelCatalog> {
  if (liveOk && !force) return snap;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const r = await fetch(`${API_URL}/api/models`);
      if (!r.ok) throw new Error("models");
      const data = await r.json();
      const catalog = Array.isArray(data.catalog) ? (data.catalog as ModelOption[]) : [];
      if (!catalog.length) throw new Error("empty");
      snap = {
        catalog,
        defaultId: typeof data.default === "string" && data.default ? data.default : snap.defaultId,
      };
      liveOk = true;
      emit();
      if (!followUp) {
        followUp = true;
        setTimeout(() => {
          liveOk = false;
          void loadModels(true);
        }, 2000);
      }
    } catch {
      liveOk = false;
      if (!snap.catalog.length) {
        snap = { catalog: FALLBACK_MODELS, defaultId: FALLBACK_MODELS[0].id };
        emit();
      }
      scheduleRetry();
    } finally {
      inflight = null;
    }
    return snap;
  })();
  return inflight;
}

export function providerOf(id: string) {
  if (id.startsWith("local:") || id.startsWith("ollama:")) return "local";
  if (id.startsWith("spark:")) return "spark";
  if (id.startsWith("openrouter:")) return "openrouter";
  return "zen";
}

export function withCurrentModel(catalog: ModelOption[], value: string): ModelOption[] {
  const id = (value || "").trim();
  if (!id || catalog.some((row) => row.id === id)) return catalog;
  return [
    {
      id,
      name: id.replace(/^(local|ollama|spark|openrouter|zen):/, ""),
      provider: providerOf(id),
      hint: "On this desk",
      available: true,
    },
    ...catalog,
  ];
}
