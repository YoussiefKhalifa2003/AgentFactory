"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { API_URL, STRENGTHS } from "@/lib/types";
import { splitPacks, useSkillCatalog } from "@/lib/skills";
import { WorkerCanvas } from "./WorkerCanvas";
import { ModelPicker } from "./ModelPicker";
import {
  ACCESSORIES,
  AgentLook,
  BODIES,
  EYES,
  HAIRS,
  HEADS,
  OUTFITS,
  lookFromName,
  randomLook,
} from "@/lib/look";
import { Chip } from "./ui/Chip";

function pigmentFromName(name: string) {
  const hues = ["#D46A3A", "#1AA6B8", "#7C5CDB", "#C45C8A", "#3D8B5F", "#C9A227", "#2F6FED"];
  return hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
}

async function lookPng(look: AgentLook, pigment: string) {
  const url = (await import("@/lib/look")).lookSvg(look, pigment, 256);
  const img = new Image();
  img.src = url;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  canvas.getContext("2d")!.drawImage(img, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png"))), "image/png");
  });
}

export function ForgeForm() {
  const router = useRouter();
  const { tools } = useSkillCatalog();
  const [colorSet, setColorSet] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pigment, setPigment] = useState("#D46A3A");
  const [strengths, setStrengths] = useState<string[]>(["coding"]);
  const [model, setModel] = useState("");
  const [look, setLookRaw] = useState<AgentLook>(() => lookFromName("New agent"));
  const [lookEdited, setLookEdited] = useState(false);
  const setLook = (next: AgentLook) => {
    setLookEdited(true);
    setLookRaw(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useMemo(
    () => ({
      id: "preview",
      name: name || "New agent",
      description,
      pigment,
      pfp: null,
      strengths,
      model: model || "big-pickle",
      instructions: "",
      look,
    }),
    [name, description, pigment, strengths, model, look]
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
          look,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
      try {
        const blob = await lookPng(look, pigment);
        const body = new FormData();
        body.append("file", blob, "look.png");
        await fetch(`${API_URL}/api/agents/${created.id}/pfp`, { method: "POST", body });
      } catch {
        /* portrait is optional */
      }
      router.push(`/?select=${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not forge");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid items-start gap-8 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
      <div className="glass sticky top-6 self-start overflow-hidden rounded-[32px]">
        <p className="px-5 pt-4 text-[11px] tracking-[0.22em] uppercase text-[var(--ink-soft)]">Studio</p>
        <WorkerCanvas agent={preview} activity="idle" mode="preview" className="h-[360px] w-full" />
      </div>
      <div className="space-y-6">
        <div className="glass space-y-4 rounded-[28px] p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="display text-2xl">Look</h2>
            <button
              type="button"
              className="btn btn-compact"
              onClick={() => setLook(randomLook())}
            >
              Randomize
            </button>
          </div>
          <label className="block text-sm">
            Name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!colorSet) setPigment(pigmentFromName(e.target.value));
                if (!lookEdited) setLookRaw(lookFromName(e.target.value || "New agent", pigment));
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
              onChange={(e) => {
                setColorSet(true);
                setPigment(e.target.value);
              }}
              className="mt-2 h-12 w-full rounded-2xl bg-transparent"
            />
          </label>
          <Row label="Body" options={BODIES} value={look.body} onPick={(body) => setLook({ ...look, body })} />
          <Row label="Head" options={HEADS} value={look.head} onPick={(head) => setLook({ ...look, head })} />
          <Row label="Hair" options={HAIRS} value={look.hair} onPick={(hair) => setLook({ ...look, hair })} />
          <Row label="Eyes" options={EYES} value={look.eyes} onPick={(eyes) => setLook({ ...look, eyes })} />
          <Row label="Outfit" options={OUTFITS} value={look.outfit} onPick={(outfit) => setLook({ ...look, outfit })} />
          <Row
            label="Accessory"
            options={ACCESSORIES}
            value={look.accessory}
            onPick={(accessory) => setLook({ ...look, accessory })}
          />
        </div>
        <div className="glass space-y-4 rounded-[28px] p-6">
          <h2 className="display text-2xl">Mind</h2>
          <label className="block text-sm">
            Description
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-2 min-h-[100px] w-full rounded-2xl bg-white/70 px-4 py-3 outline-none"
              placeholder="What this bay is for"
            />
          </label>
          <p className="text-sm text-[var(--ink-soft)]">One or two strengths. The first one is the job.</p>
          <div className="flex flex-wrap gap-2">
            {STRENGTHS.map((o) => (
              <Chip key={o.id} on={strengths.includes(o.id)} pigment={pigment} onClick={() => toggleStrength(o.id)}>
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
        <div className="glass space-y-4 rounded-[28px] p-6">
          <h2 className="display text-2xl">Skills & model</h2>
          <div className="flex flex-wrap gap-2">
            {tools.map((o) => (
              <Chip key={o.id} on={strengths.includes(o.id)} pigment={pigment} onClick={() => toggleTool(o.id)}>
                {o.label}
              </Chip>
            ))}
          </div>
          <ModelPicker value={model} onChange={setModel} />
          <button type="submit" disabled={busy || !name.trim()} className="btn btn-pigment px-5 py-3" style={{ background: pigment }}>
            {busy ? "Savingâ€¦" : "Create agent"}
          </button>
          {error && <p className="text-sm text-[var(--alert)]">{error}</p>}
        </div>
      </div>
    </form>
  );
}

function Row<T extends string>({
  label,
  options,
  value,
  onPick,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <Chip key={opt} on={value === opt} onClick={() => onPick(opt)}>
            {opt}
          </Chip>
        ))}
      </div>
    </div>
  );
}
