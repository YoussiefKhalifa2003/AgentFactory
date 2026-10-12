"use client";

export const VOICE_MUTE_KEY = "foundry.voice.mute";

type AgentLike = { id: string; name: string };

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((ev: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function Recognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function speechAvailable() {
  return Boolean(Recognition());
}

export function isMuted() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(VOICE_MUTE_KEY) === "1";
}

export function setMuted(next: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VOICE_MUTE_KEY, next ? "1" : "0");
  if (next && typeof window.speechSynthesis !== "undefined") window.speechSynthesis.cancel();
}

export function speak(text: string) {
  if (typeof window === "undefined") return;
  if (isMuted()) return;
  if (window.localStorage.getItem("foundry.quality") === "off") return;
  if (typeof window.speechSynthesis === "undefined") return;
  const clean = firstSentence(text);
  if (!clean) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = navigator.language || "en-GB";
  window.speechSynthesis.speak(u);
}

export function firstSentence(text: string) {
  const blob = (text || "").replace(/\s+/g, " ").trim();
  if (!blob) return "";
  const cut = blob.split(/(?<=[.!?])\s/)[0] || blob;
  return cut.slice(0, 220);
}

export function startListen(opts: {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onEnd?: () => void;
}) {
  const Ctor = Recognition();
  if (!Ctor) return { stop() {} };
  const rec = new Ctor();
  rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-GB";
  rec.interimResults = true;
  rec.continuous = false;
  rec.onresult = (ev) => {
    let interim = "";
    let finals = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const row = ev.results[i];
      const piece = row[0]?.transcript || "";
      if (row.isFinal) finals += piece;
      else interim += piece;
    }
    if (interim && opts.onInterim) opts.onInterim(interim.trim());
    if (finals && opts.onFinal) opts.onFinal(finals.trim());
  };
  rec.onerror = () => opts.onEnd?.();
  rec.onend = () => opts.onEnd?.();
  try {
    rec.start();
  } catch {
    opts.onEnd?.();
  }
  return {
    stop() {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

export type VoiceIntent =
  | { action: "assign"; agentId?: string; text: string; meeting?: boolean }
  | { action: "cancel"; agentName?: string }
  | { action: "none"; text: string };

export function parseVoiceCommand(raw: string, agents: AgentLike[]): VoiceIntent {
  const text = (raw || "").trim();
  if (!text) return { action: "none", text: "" };
  const low = text.toLowerCase();
  if (/^(never mind|cancel|stop)\b/.test(low) || /^stop\s+\w+/.test(low)) {
    const named = agents.find((a) => low.includes(a.name.toLowerCase()));
    return { action: "cancel", agentName: named?.name };
  }
  const meeting = /\b(last meeting|the meeting)\b/i.test(text);
  const prefix = text.match(/^([A-Za-z][A-Za-z0-9_-]{1,24})\s*[,:]\s*(.+)$/);
  if (prefix) {
    const hit = agents.find((a) => a.name.toLowerCase() === prefix[1].toLowerCase());
    if (hit) return { action: "assign", agentId: hit.id, text: prefix[2].trim(), meeting };
  }
  for (const agent of agents) {
    const re = new RegExp(`^(hey\\s+)?${agent.name}\\b[,:]?\\s*(.*)`, "i");
    const m = text.match(re);
    if (m && (m[2] || "").trim()) {
      return { action: "assign", agentId: agent.id, text: m[2].trim(), meeting };
    }
  }
  return { action: "assign", text, meeting };
}

export async function resolveMeetingListId(apiUrl: string, meeting?: boolean, fallback = "inbox") {
  if (!meeting) return fallback;
  try {
    const r = await fetch(`${apiUrl}/api/lists`);
    const data = await r.json();
    const lists = (data.lists || data || []) as { id?: string }[];
    const mtg = lists.find((row) => String(row.id || "").startsWith("mtg-"));
    if (mtg?.id) return mtg.id;
  } catch {
    /* keep fallback */
  }
  return fallback;
}
