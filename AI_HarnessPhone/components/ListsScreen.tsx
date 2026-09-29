"use client";

import { FormEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/config";
import { useFactory } from "@/lib/factory";
import { Artifact, ListItem, TaskList } from "@/lib/types";
import { AgentSheet } from "./AgentSheet";

export function ListsScreen({
  onPreview,
}: {
  onPreview: (jobId: string, file: Artifact) => void;
}) {
  const { agents, select, taskTick } = useFactory();
  const [lists, setLists] = useState<TaskList[]>([]);
  const [openId, setOpenId] = useState("inbox");
  const [items, setItems] = useState<ListItem[]>([]);
  const [draft, setDraft] = useState("");
  const [sheetItem, setSheetItem] = useState<ListItem | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [meetingsOpen, setMeetingsOpen] = useState(false);
  const [mine, setMine] = useState(true);

  const openList = lists.find((l) => l.id === openId) || null;
  const isDone = openId === "done" || openList?.kind === "done";
  const isMeeting = openList?.kind === "meeting";
  const yours = lists.filter((l) => l.kind !== "meeting");
  const meetings = lists.filter((l) => l.kind === "meeting");

  async function loadLists() {
    const r = await apiFetch("/api/lists");
    const data = await r.json();
    setLists(data.lists || []);
  }

  async function loadItems(id: string) {
    const r = await apiFetch(`/api/lists/${id}`);
    const data = await r.json();
    setItems(data.items || []);
  }

  useEffect(() => {
    loadLists().catch(() => undefined);
  }, [taskTick]);

  useEffect(() => {
    loadItems(openId).catch(() => undefined);
    setPicked([]);
    setSelecting(false);
    if (openList?.kind === "meeting") setMeetingsOpen(true);
  }, [openId, taskTick, openList?.kind]);

  const visible = useMemo(() => {
    let base = isMeeting && mine ? items.filter((item) => item.mine) : items;
    if (!isDone) base = base.filter((item) => item.status !== "done");
    return base;
  }, [items, isDone, isMeeting, mine]);

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isDone) return;
    await apiFetch(`/api/lists/${openId}/items`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    setDraft("");
    await loadItems(openId);
    await loadLists();
  }

  async function removeIds(ids: string[]) {
    for (const id of ids) {
      await apiFetch(`/api/items/${id}`, { method: "DELETE" });
    }
    setPicked([]);
    setSelecting(false);
    await loadItems(openId);
    await loadLists();
  }

  function onRow(item: ListItem) {
    if (selecting) {
      setPicked((cur) => (cur.includes(item.id) ? cur.filter((x) => x !== item.id) : [...cur, item.id]));
      return;
    }
    if (isDone || item.virtual) {
      if (item.agent_id) select(item.agent_id);
      if (item.job_id && item.artifact) onPreview(item.job_id, item.artifact);
      return;
    }
    if (item.status === "open" || item.status === "blocked") {
      setSheetItem(item);
      return;
    }
    if (item.agent_id) select(item.agent_id);
  }

  function openListId(id: string) {
    setOpenId(id);
    setMeetingsOpen(false);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hide-scroll flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 pt-0.5">
        {yours.map((list) => {
          const count = list.kind === "done" ? list.item_count : list.open_count + list.working_count;
          const on = openId === list.id;
          return (
            <button
              key={list.id}
              type="button"
              aria-current={on ? "true" : undefined}
              className={`btn btn-compact shrink-0 snap-start gap-1.5 px-3 ${on ? "btn-solid" : ""}`}
              onClick={() => openListId(list.id)}
            >
              <span>{list.title}</span>
              {count ? (
                <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${on ? "bg-white/20" : "bg-[var(--paper)] text-[var(--ink-soft)]"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        {meetings.length > 0 && (
          <button
            type="button"
            aria-expanded={meetingsOpen}
            className={`btn btn-compact shrink-0 snap-start gap-1.5 px-3 ${isMeeting || meetingsOpen ? "btn-solid" : ""}`}
            onClick={() => setMeetingsOpen((open) => !open)}
          >
            Meetings
            <span className={`rounded-full px-1.5 text-[11px] tabular-nums ${isMeeting || meetingsOpen ? "bg-white/20" : "bg-[var(--paper)] text-[var(--ink-soft)]"}`}>
              {meetingsOpen ? "Hide" : meetings.length}
            </span>
          </button>
        )}
      </div>

      {meetingsOpen && (
        <div className="hide-scroll mx-3 mb-2 max-h-40 min-h-0 overflow-y-auto rounded-2xl bg-white/70 p-1">
          {meetings.map((list) => {
            const on = openId === list.id;
            const count = list.open_count + list.working_count;
            return (
              <button
                key={list.id}
                type="button"
                aria-current={on ? "true" : undefined}
                className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left ${
                  on ? "bg-[var(--ink)] text-white" : "text-[var(--ink)]"
                }`}
                onClick={() => setOpenId(list.id)}
              >
                <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{list.title}</span>
                {count ? <span className={`text-[12px] tabular-nums ${on ? "text-white/80" : "text-[var(--ink-soft)]"}`}>{count}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2">
        {selecting ? (
          <>
            <p className="min-w-0 truncate text-[15px] font-medium">{picked.length} selected</p>
            <div className="flex shrink-0 gap-1.5">
              {picked.length > 0 && (
                <button type="button" className="btn btn-compact px-3" onClick={() => removeIds(picked)}>
                  Delete
                </button>
              )}
              <button
                type="button"
                className="btn btn-compact btn-solid px-3"
                onClick={() => {
                  setSelecting(false);
                  setPicked([]);
                }}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">Open list</p>
              <p className="truncate text-[15px] font-medium leading-tight">{openList?.title || "Inbox"}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {isMeeting && (
                <div className="flex rounded-full border border-[rgba(28,24,20,0.12)] bg-white p-0.5">
                  <button
                    type="button"
                    className={`btn btn-compact min-h-9 px-2.5 py-1 ${mine ? "btn-solid" : "border-transparent bg-transparent"}`}
                    aria-pressed={mine}
                    onClick={() => setMine(true)}
                  >
                    Mine
                  </button>
                  <button
                    type="button"
                    className={`btn btn-compact min-h-9 px-2.5 py-1 ${!mine ? "btn-solid" : "border-transparent bg-transparent"}`}
                    aria-pressed={!mine}
                    onClick={() => setMine(false)}
                  >
                    All
                  </button>
                </div>
              )}
              {!isDone && visible.length > 0 && (
                <button
                  type="button"
                  className={`btn btn-compact px-3 ${selecting ? "btn-solid" : ""}`}
                  onClick={() => {
                    setSelecting(true);
                    setPicked([]);
                  }}
                >
                  Select
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {visible.length === 0 && (
          <p className="px-2 py-10 text-center text-[15px] text-[var(--ink-soft)]">Nothing here yet.</p>
        )}
        {visible.map((item) => {
          const assigned = agents.find((a) => a.id === item.agent_id);
          const chosen = picked.includes(item.id);
          const mark =
            item.status === "done" ? "✓" : item.status === "blocked" ? "!" : item.status === "working" ? "●" : "○";
          return (
            <SwipeRow
              key={item.id}
              disabled={selecting || isDone || Boolean(item.virtual)}
              onDelete={() => removeIds([item.id])}
            >
              <article
                className={`tap rounded-2xl px-3 py-3 ${chosen ? "bg-white ring-1 ring-[var(--ink)]" : ""}`}
                onClick={() => onRow(item)}
              >
                <div className="flex items-start gap-2">
                  {selecting && (
                    <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[rgba(28,24,20,0.28)]">
                        {chosen ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--ink)]" /> : null}
                      </span>
                    </span>
                  )}
                  <span className="mt-0.5 w-4 shrink-0 text-center text-xs text-[var(--ink-soft)]">{mark}</span>
                  <p className="min-w-0 flex-1 text-[16px] leading-5">{item.text}</p>
                </div>
                <div className="mt-1.5 pl-6 text-[13px] text-[var(--ink-soft)]">
                  {assigned && (
                    <span className="font-medium" style={{ color: assigned.pigment }}>
                      {assigned.name}
                    </span>
                  )}
                  {isDone && item.artifact && <span>{assigned ? " · " : ""}View</span>}
                  {isDone && !item.artifact && item.recap && (
                    <span className="line-clamp-3">{item.recap}</span>
                  )}
                  {item.status === "blocked" && <span className="text-[var(--alert)]">Needs attention</span>}
                </div>
              </article>
            </SwipeRow>
          );
        })}
      </div>

      {!isDone && (
        <form onSubmit={addTask} className="shrink-0 border-t border-[var(--line)] px-3 py-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task"
            className="min-h-11 w-full rounded-full bg-white px-4 text-[16px]"
          />
        </form>
      )}

      {sheetItem && (
        <AgentSheet
          item={sheetItem}
          onClose={() => setSheetItem(null)}
          onAssigned={() => {
            setSheetItem(null);
            loadItems(openId);
            loadLists();
          }}
        />
      )}
    </div>
  );
}

function SwipeRow({
  children,
  disabled,
  onDelete,
}: {
  children: React.ReactNode;
  disabled: boolean;
  onDelete: () => void;
}) {
  const startX = useRef(0);
  const dxRef = useRef(0);
  const dragging = useRef(false);
  const [dx, setDx] = useState(0);

  function down(e: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    dragging.current = true;
    startX.current = e.clientX;
    dxRef.current = 0;
    setDx(0);
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    if (disabled || !dragging.current) return;
    const next = Math.min(0, e.clientX - startX.current);
    dxRef.current = next;
    if (next < -8) setDx(next);
  }

  function up() {
    if (dragging.current && dxRef.current < -80) onDelete();
    dragging.current = false;
    dxRef.current = 0;
    setDx(0);
    startX.current = 0;
  }

  return (
    <div className="relative mb-1 overflow-hidden rounded-2xl">
      <div className="absolute inset-y-0 right-0 flex items-center bg-[var(--alert)] px-4 text-[15px] text-white">
        Delete
      </div>
      <div
        className="relative bg-transparent"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
      >
        {children}
      </div>
    </div>
  );
}
