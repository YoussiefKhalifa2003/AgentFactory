"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, STRENGTHS } from "@/lib/types";
import { splitPacks, useSkillCatalog } from "@/lib/skills";
import { WorkerCanvas } from "./WorkerCanvas";
import { ModelPicker } from "./ModelPicker";

function pigmentFromName(name: string) {
  const hues = [
    "#D46A3A",
    "#1AA6B8",
    "#7C5CDB",
    "#C45C8A",
    "#3D8B5F",
    "#C9A227",
    "#2F6FED",
  ];
  return hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
}

export function ForgeForm() {
  const router = useRouter();
  const { tools } = useSkillCatalog();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pigment, setPigment] = useState("#D46A3A");
  const [strengths, setStrengths] = useState<string[]>(["coding"]);
  const [model, setModel] = useState("");
  const [pfp, setPfp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => ({
      id: "preview",
      name: name || "New agent",
      description,
      pigment,
      pfp,
      strengths,
      model: model || "big-pickle",
      instructions: "",
    }),
    [name, description, pigment, pfp, strengths, model]
  );

  function toggleStrength(id: string) {
    setStrengths((cur) => {
      const split = splitPacks(cur, tools);
      if (split.domain.includes(id)) {
        const next = split.domain.filter((x) => x !== id);
        return [...(next.length ? next : split.domain), ...split.tools];
      }
      return [[...split.domain, id].slice(-2), ...split.tools].flat();
    });
  }

  function toggleTool(id: string) {
    setStrengths((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await fetch(`${API_URL}/api/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          pigment,
          strengths,
          model: model || undefined,
          pfp,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
      router.push(`/?select=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not forge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="space-y-6">
        <ol className="flex gap-3 text-xs tracking-[0.2em] uppercase text-[var(--ink-soft)]">
          {["Look", "Mind", "Tools"].map((label, i) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => setStep(i)}
                className={step === i ? "text-[var(--ink)]" : ""}
              >
                {String(i + 1).padStart(2, "0")} {label}
              </button>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="glass space-y-4 rounded-[28px] p-6">
            <label className="block text-sm">
              Name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!name) setPigment(pigmentFromName(e.target.value));
                }}
                className="mt-2 w-full rounded-2xl bg-white/70 px-4 py-3 outline-none"
                placeholder="Newton"
                required
              />
            </label>
            <label className="block text-sm">
              Pigment
              <input
                type="color"
                value={pigment}
                onChange={(e) => setPigment(e.target.value)}
                className="mt-2 h-12 w-full rounded-2xl bg-transparent"
              />
            </label>
            <label className="block text-sm">
              Portrait (identity media, not a face map)
              <input
                type="file"
                accept="image/*"
                className="mt-2"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => setPfp(String(reader.result));
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          </div>
        )}

        {step === 1 && (
          <div className="glass space-y-4 rounded-[28px] p-6">
            <label className="block text-sm">
              Description
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-2 min-h-[120px] w-full rounded-2xl bg-white/70 px-4 py-3 outline-none"
                placeholder="What this bay is for"
              />
            </label>
            <p className="text-sm text-[var(--ink-soft)]">Pick one or two strengths</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {STRENGTHS.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => toggleStrength(o.id)}
                  className="rounded-2xl bg-white/70 px-4 py-3 text-left"
                  style={{
                    outline: strengths.includes(o.id)
                      ? `2px solid ${pigment}`
                      : undefined,
                  }}
                >
                  <span className="font-medium">{o.label}</span>
                  <span className="mt-1 block text-sm text-[var(--ink-soft)]">
                    {o.copy}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="glass space-y-4 rounded-[28px] p-6">
            <p className="text-sm text-[var(--ink-soft)]">
              Optional tool skills. Strengths stay at two; these stack on top.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {tools.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => toggleTool(o.id)}
                  className="rounded-2xl bg-white/70 px-4 py-3 text-left"
                  style={{
                    outline: strengths.includes(o.id) ? `2px solid ${pigment}` : undefined,
                  }}
                >
                  <span className="font-medium">{o.label}</span>
                  <span className="mt-1 block text-sm text-[var(--ink-soft)]">{o.copy}</span>
                </button>
              ))}
            </div>
            <p className="text-sm text-[var(--ink-soft)]">
              Pick the brain this bay uses. OpenCode Zen if it is free, OpenRouter
              if you want a cloud desk, or the 4090 on this machine.
            </p>
            <ModelPicker value={model} onChange={setModel} />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="btn btn-pigment px-5 py-3"
              style={{ background: pigment }}
            >
              {busy ? "Saving…" : "Create agent"}
            </button>
            {error && <p className="text-sm text-[#b42318]">{error}</p>}
          </div>
        )}

        <div className="flex gap-3">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep((s) => s - 1)}
              className="btn"
            >
              Back
            </button>
          )}
          {step < 2 && (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="btn btn-solid"
            >
              Next
            </button>
          )}
        </div>
      </div>
      <div className="glass sticky top-6 self-start overflow-hidden rounded-[32px]">
        <p className="px-5 pt-4 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-soft)]">
          Preview
        </p>
        <WorkerCanvas
          agent={preview}
          activity="idle"
          mode="preview"
          className="h-[320px] w-full"
        />
      </div>
    </form>
  );
}
