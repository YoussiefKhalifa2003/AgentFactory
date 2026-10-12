"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { API_URL, BrainSnapshot } from "@/lib/types";
import { sharesFromFloor } from "@/lib/brainShare";
import { useFactory } from "@/lib/factory";

const BrainSpecimen = dynamic(
  () => import("./scene/BrainSpecimen").then((m) => m.BrainSpecimen),
  { ssr: false }
);

function skipWebGL(quality: string) {
  if (quality === "off") return true;
  if (typeof window === "undefined") return true;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return coarse && window.innerWidth < 768;
}

export function BrainOverlay() {
  const { brainOpen, setBrainOpen, brain, agents, jobs, live, traces, quality, selectedId, select } = useFactory();
  const [draft, setDraft] = useState("");
  const [wiki, setWiki] = useState("");
  const [wikiUrl, setWikiUrl] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [snap, setSnap] = useState<BrainSnapshot | null>(brain);
  const [deskJobs, setDeskJobs] = useState<Record<string, number>>({});
  const [regionId, setRegionId] = useState<string | null>(null);

  useEffect(() => {
    setSnap(brain);
  }, [brain]);

  useEffect(() => {
    if (!brainOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setBrainOpen(false);
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    fetch(`${API_URL}/api/brain`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setSnap(data as BrainSnapshot);
      })
      .catch(() => undefined);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [brainOpen, setBrainOpen]);

  useEffect(() => {
    if (!brainOpen) return;
    fetch(`${API_URL}/api/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const map: Record<string, number> = {};
        for (const desk of data?.desks || []) {
          if (desk?.id) map[desk.id] = Number(desk.jobs) || 0;
        }
        setDeskJobs(map);
      })
      .catch(() => undefined);
  }, [brainOpen, jobs.length]);

  useEffect(() => {
    if (!snap) return;
    setWiki(snap.wiki_md || "");
    setWikiUrl(snap.wiki_url || "");
    setDraft(snap.organization || "");
    const names = (snap.projects || []).filter((p) => p.included).map((p) => p.name);
    setPicked(names);
  }, [snap]);

  useEffect(() => {
    if (snap?.studying) setSyncing(true);
    else if (snap && !snap.studying) setSyncing(false);
  }, [snap?.studying]);

  const flare = useMemo(() => {
    const cutoff = Date.now() - 8000;
    return Object.values(traces).some((events) =>
      (events || []).some((ev) => {
        const name = String(ev.payload?.name || ev.label || "");
        if (name !== "repo_search" && name !== "repo_read") return false;
        const at = ev.at ? Date.parse(ev.at) : Date.now();
        return Number.isFinite(at) && at >= cutoff;
      })
    );
  }, [traces]);

  const hideCanvas = skipWebGL(quality);
  const empty = !(snap?.projects || []).some((p) => p.included) && !(snap?.wiki_md || "").trim();
  const shares = useMemo(
    () => sharesFromFloor(agents, jobs, live, traces, deskJobs),
    [agents, jobs, live, traces, deskJobs]
  );
  const totalShare = shares.reduce((sum, row) => sum + row.weight, 0) || 1;
  const ranked = [...shares].sort((a, b) => b.weight - a.weight);
  const owner = ranked[0];

  async function discover(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSyncing(true);
    try {
      const r = await fetch(`${API_URL}/api/brain/discover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: draft.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.detail || "Study failed");
        setSyncing(false);
        return;
      }
      setSnap(data as BrainSnapshot);
      setPicked((data.projects || []).map((p: { name: string }) => p.name));
      if (!data.studying) setSyncing(false);
    } catch {
      setError("Can’t reach the API.");
      setSyncing(false);
    }
  }

  async function saveAndSync(alsoSync: boolean) {
    setError("");
    setSyncing(true);
    try {
      const r = await fetch(`${API_URL}/api/brain`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization: draft.trim(),
          wiki_url: wikiUrl.trim(),
          wiki_md: wiki,
          project_names: picked,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.detail || "Save failed");
        setSyncing(false);
        return;
      }
      setSnap(data as BrainSnapshot);
      if (!alsoSync) {
        setSyncing(false);
        return;
      }
      const s = await fetch(`${API_URL}/api/brain/sync`, { method: "POST" });
      const synced = await s.json();
      setSnap(synced as BrainSnapshot);
      if (!synced.studying) setSyncing(false);
    } catch {
      setError("Can’t reach the API.");
      setSyncing(false);
    }
  }

  if (!brainOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[450] flex flex-col bg-[rgba(28,24,20,0.38)] p-3 sm:p-5"
      role="presentation"
      onClick={() => setBrainOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Agent Brain"
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] bg-[#efe4d4] shadow-[0_24px_80px_rgba(28,24,20,0.28)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
          <div>
            <h2 className="display text-2xl">Brain</h2>
            <p className="text-[11px] text-[var(--ink-soft)]">Plant knowledge · live cortex share</p>
          </div>
          <button type="button" className="btn btn-compact" onClick={() => setBrainOpen(false)}>
            Close
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden px-3 pb-3 lg:grid-cols-[minmax(232px,16.5rem)_minmax(0,1fr)_minmax(268px,19rem)]">
          <div className="flex min-h-0 flex-col overflow-hidden">
            {owner && (
              <div className="paper-card shrink-0 overflow-hidden">
                <div className="px-4 pb-3 pt-3">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-[var(--ink-soft)]">Cortex share</p>
                  <p className="display mt-1 text-[2.35rem] leading-none tabular-nums">
                    {Math.round((owner.weight / totalShare) * 100)}
                    <span className="ml-0.5 text-[1.05rem] text-[var(--ink-soft)]">%</span>
                  </p>
                  <p className="mt-1 truncate text-sm">{owner.name} holds the specimen</p>
                </div>
                <div className="h-1.5 w-full" style={{ background: owner.pigment }} />
              </div>
            )}
            <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-0.5">
              {ranked.map((row, i) => {
                const pct = Math.round((row.weight / totalShare) * 100);
                const on = selectedId === row.id;
                const over = regionId === row.id && !on;
                const caption = row.live
                  ? row.caption || "Working"
                  : flare && on
                    ? "Reading the estate"
                    : row.jobs
                      ? `${row.jobs} job${row.jobs === 1 ? "" : "s"}`
                      : "Idle";
                return (
                  <button
                    key={row.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => select(row.id)}
                    className={`w-full px-3 py-3 text-left transition ${
                      on
                        ? "rounded-[var(--radius-lg)] bg-[var(--ink)] text-[#fff7ee] shadow-[var(--shadow-2)]"
                        : over
                          ? "paper-card ring-2 ring-[var(--ink)]"
                          : "paper-card hover:bg-[color-mix(in_srgb,var(--paper)_40%,white)]"
                    }`}
                  >
                    <div className="flex gap-3">
                      <span
                        className="shrink-0 self-stretch rounded-full"
                        style={{ width: on ? 6 : 3, background: row.pigment }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span>
                            <span
                              className={`block text-[10px] tabular-nums tracking-[0.12em] ${on ? "text-[#fff7ee]/55" : "text-[var(--ink-soft)]"}`}
                            >
                              {String(i + 1).padStart(2, "0")}
                              {on ? " · on specimen" : ""}
                            </span>
                            <span className="block truncate text-sm font-medium leading-tight">{row.name}</span>
                          </span>
                          <span className="display text-[1.7rem] leading-none tabular-nums">{pct}</span>
                        </span>
                        <span className={`mt-2 block h-[3px] overflow-hidden rounded-full ${on ? "bg-white/20" : "bg-black/[0.07]"}`}>
                          <span
                            className="block h-full rounded-full transition-[width] duration-500"
                            style={{ width: `${pct}%`, background: row.pigment }}
                          />
                        </span>
                        <span
                          className={`mt-2 ${
                            row.live ? "status-pill is-working" : on ? "text-[11px] text-[#fff7ee]/70" : "text-[11px] text-[var(--ink-soft)]"
                          }`}
                        >
                          {caption}
                        </span>
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="relative min-h-[220px] overflow-hidden rounded-[22px] bg-[#d4c6b4]">
            {hideCanvas ? (
              <div className="flex h-full items-end px-5 py-4">
                <p className="display text-[1.6rem] text-[var(--ink)]">Specimen</p>
              </div>
            ) : (
              <BrainSpecimen
                className="h-full min-h-[220px]"
                shares={shares}
                selectedId={selectedId}
                onSelect={select}
                onRegion={setRegionId}
              />
            )}
            <div className="pointer-events-none absolute bottom-3 left-4">
              <p className="display text-[1.05rem] text-[var(--ink)]/55">Specimen</p>
              <p className="text-[10px] text-[var(--ink)]/40">Winkler · Brainder.org</p>
            </div>
          </div>
          <div className="paper-card flex min-h-0 flex-col overflow-auto p-4">
            <p className="text-sm text-[var(--ink-soft)]">
              Paste the org once. Agent Brain clones every project and every repo, then reads every text file into a
              plant catalog. Inbox jobs with no list pin search that catalog. Models are not retrained. Hover a fold
              to see who holds that region.
            </p>
            {empty && (
              <p className="mt-2 text-sm">Paste the org URL and press Study the estate.</p>
            )}
            <form onSubmit={discover} className="mt-3">
              <label className="text-[11px] text-[var(--ink-soft)]">
                Org URL
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="https://tatweer-co.visualstudio.com/"
                  className="mt-1 w-full rounded-xl bg-[var(--paper)] px-3 py-2 text-sm outline-none"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className="btn btn-solid px-3 py-1 text-xs" disabled={syncing || !draft.trim()}>
                  {syncing ? "Studying…" : "Study the estate"}
                </button>
                <button
                  type="button"
                  className="btn btn-compact px-3 py-1 text-xs"
                  disabled={syncing}
                  onClick={() => saveAndSync(true)}
                >
                  Refresh
                </button>
              </div>
            </form>
            {!snap?.has_pat && (
              <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">
                Add AZURE_DEVOPS_PAT to apps/api/.env (code-read). Then paste the org — every repo and every file is
                cloned and catalogued.
              </p>
            )}
            {(snap?.study_files || 0) > 0 && (
              <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
                Catalogued {snap?.study_projects || 0} projects · {snap?.study_repos || 0} repos · {snap?.study_files}{" "}
                files
              </p>
            )}
            {(snap?.projects || []).length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] text-[var(--ink-soft)]">
                  Every project is included. Uncheck one only if you want it dropped.
                </p>
                <ul className="mt-1 grid gap-1">
                  {(snap?.projects || []).map((project) => {
                    const on = picked.includes(project.name);
                    return (
                      <li key={project.name}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-[var(--paper)]">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              setPicked((cur) =>
                                on ? cur.filter((n) => n !== project.name) : [...cur, project.name]
                              )
                            }
                          />
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                          <span className="text-[11px] text-[var(--ink-soft)]">{project.repo_count || 0} repos</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <label className="mt-3 text-[11px] text-[var(--ink-soft)]">
              Wiki URL, optional
              <input
                value={wikiUrl}
                onChange={(e) => setWikiUrl(e.target.value)}
                placeholder="…/_wiki/wikis/…"
                className="mt-1 w-full rounded-xl bg-[var(--paper)] px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="mt-3 text-[11px] text-[var(--ink-soft)]">
              Wiki / brief (markdown)
              <textarea
                value={wiki}
                onChange={(e) => setWiki(e.target.value)}
                rows={7}
                className="mt-1 w-full resize-y rounded-xl bg-[var(--paper)] px-3 py-2 text-sm outline-none"
                placeholder="How this plant is put together…"
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-compact px-3 py-1 text-xs" disabled={syncing} onClick={() => saveAndSync(false)}>
                Save brief
              </button>
              {snap?.synced_at && (
                <span className="text-[11px] text-[var(--ink-soft)]">
                  Last synced {new Date(snap.synced_at).toLocaleString()}
                </span>
              )}
            </div>
            {(error || snap?.sync_error) && (
              <p className="mt-2 text-[11px] leading-4 text-[var(--ink-soft)]">{error || snap?.sync_error}</p>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
