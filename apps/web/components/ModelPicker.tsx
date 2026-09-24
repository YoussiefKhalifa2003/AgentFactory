"use client";

import { useEffect, useMemo, useState } from "react";
import { API_URL, ModelOption } from "@/lib/types";

const GROUPS: { id: string; label: string }[] = [
  { id: "local", label: "This machine" },
  { id: "spark", label: "Spark" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "zen", label: "OpenCode Zen" },
];

export function useModelCatalog() {
  const [catalog, setCatalog] = useState<ModelOption[]>([]);
  const [defaultId, setDefaultId] = useState("big-pickle");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/models`)
      .then((r) => {
        if (!r.ok) throw new Error("models");
        return r.json();
      })
      .then((data) => {
        setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
        if (data.default) setDefaultId(data.default);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);

  return { catalog, defaultId, failed };
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
  const { catalog, defaultId, failed } = useModelCatalog();
  const selected = value || defaultId;

  useEffect(() => {
    if (compact) return;
    if (!value && defaultId) onChange(defaultId);
  }, [compact, defaultId, onChange, value]);

  const grouped = useMemo(() => {
    return GROUPS.map((group) => ({
      ...group,
      models: catalog.filter((m) => m.provider === group.id),
    })).filter((g) => g.models.length > 0);
  }, [catalog]);

  if (failed) {
    return <p className="text-sm text-[#b42318]">Couldn’t load models.</p>;
  }

  if (catalog.length === 0) {
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
                  {m.name}
                  {m.available ? "" : " · not running"}
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
