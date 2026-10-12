"use client";

import { useEffect, useMemo, useState } from "react";
import { ModelOption } from "@/lib/types";
import {
  getModelCatalog,
  subscribeModels,
  warmupModels,
  withCurrentModel,
} from "@/lib/models";

const GROUPS: { id: string; label: string }[] = [
  { id: "spark", label: "Spark" },
  { id: "local", label: "This machine" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "zen", label: "OpenCode Zen" },
];

function optionLabel(m: ModelOption) {
  const where =
    m.provider === "spark" ? " · Spark" : m.provider === "local" ? " · this GPU" : "";
  return `${m.name}${where}${m.available ? "" : " · not running"}`;
}

export function useModelCatalog() {
  const [catalog, setCatalog] = useState<ModelOption[]>(() => getModelCatalog().catalog);
  const [defaultId, setDefaultId] = useState(() => getModelCatalog().defaultId);

  useEffect(() => {
    const unsub = subscribeModels((next) => {
      setCatalog(next.catalog);
      setDefaultId(next.defaultId);
    });
    warmupModels();
    return unsub;
  }, []);

  return { catalog, defaultId };
}

export function ModelPicker({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const { catalog, defaultId } = useModelCatalog();
  const selected = value || defaultId;
  const rows = useMemo(() => withCurrentModel(catalog, selected), [catalog, selected]);

  useEffect(() => {
    if (compact) return;
    if (!value && defaultId) onChange(defaultId);
  }, [compact, defaultId, onChange, value]);

  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      models: rows.filter((m) => m.provider === group.id),
    })).filter((g) => g.models.length > 0);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-soft)]">Loading available desks…</p>
    );
  }

  if (compact) {
    return (
      <label className="block text-sm">
        Model
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-2xl bg-white/70 px-4 py-2 outline-none"
        >
          {grouped.map((group) => (
            <optgroup key={group.id} label={group.label}>
              {group.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {optionLabel(m)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map((group) => (
        <div key={group.id}>
          <p className="mb-2 text-[11px] uppercase tracking-[0.2em] text-[var(--ink-soft)]">
            {group.label}
            {group.id === "local" ? " · one GPU job at a time" : ""}
          </p>
          <div className="grid gap-2">
            {group.models.map((m) => {
              const active = selected === m.id;
              return (
                <button
                  type="button"
                  key={m.id}
                  onClick={() => onChange(m.id)}
                  className="rounded-2xl bg-white/70 px-4 py-3 text-left"
                  style={{
                    outline: active ? "2px solid var(--ink)" : undefined,
                    opacity: m.available ? 1 : 0.62,
                  }}
                >
                  <span className="font-medium">{m.name}</span>
                  <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                    {m.hint}
                    {m.vram ? ` · ${m.vram}` : ""}
                    {m.available ? "" : " · not loaded"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
