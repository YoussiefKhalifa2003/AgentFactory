"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { API_URL, ListItem, Strength, TaskList, strengthLabel } from "@/lib/types";
import { pickBestAgent, TASK_MIME, taskDragPayload } from "@/lib/tasks";
import { useFactory } from "@/lib/factory";

function readRepoLink(raw: string) {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const gitAt = parts.findIndex((part) => part.toLowerCase() === "_git");
  if (host === "dev.azure.com" && gitAt >= 2 && parts[gitAt + 1]) {
    return {
      organization: decodeURIComponent(parts[0]),
      project: decodeURIComponent(parts[1]),
      repository: decodeURIComponent(parts[gitAt + 1]),
    };
  }
  if (host.endsWith(".visualstudio.com") && gitAt >= 1 && parts[gitAt + 1]) {
    return {
      organization: host.replace(".visualstudio.com", ""),
      project: decodeURIComponent(parts[0]),
      repository: decodeURIComponent(parts[gitAt + 1]),
    };
  }
  return null;
}

export function ListsSidebar({
  onDragStrength,
}: {
  onDragStrength: (strength: Strength | null) => void;
}) {
  const { agents, assignWork, select, taskTick, setOpenListId } = useFactory();
  const [lists, setLists] = useState<TaskList[]>([]);
  const [openId, setOpenId] = useState<string>("inbox");
  const [items, setItems] = useState<ListItem[]>([]);
  const [mine, setMine] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [meetingsFound, setMeetingsFound] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [removing, setRemoving] = useState(false);
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [manual, setManual] = useState(false);
  const [linkForm, setLinkForm] = useState({
    organization: "",
    project: "",
    repository: "",
  });

  const openList = lists.find((l) => l.id === openId) || null;
  const isMeeting = openList?.kind === "meeting";

  async function loadLists() {
    try {
      const data = await fetch(`${API_URL}/api/lists`).then((r) => r.json());
      setLists(data.lists || []);
      setMeetingsFound(data.meetings ? Boolean(data.meetings.found) : null);
      setError(null);
      setOpenId((cur) => {
        if (cur && (data.lists || []).some((l: TaskList) => l.id === cur)) return cur;
        return data.lists?.[0]?.id || "inbox";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load lists");
    }
  }

  async function loadItems(listId: string) {
    if (!listId) {
      setItems([]);
      return;
    }
    try {
      const data = await fetch(`${API_URL}/api/lists/${listId}`).then((r) => r.json());
      setItems(data.items || []);
    } catch {
      setItems([]);
    }
  }

  useEffect(() => {
    loadLists();
    const timer = window.setInterval(loadLists, 20000);
    return () => window.clearInterval(timer);
  }, [taskTick]);

  useEffect(() => {
    setPicked([]);
  }, [openId]);

  useEffect(() => {
    setOpenListId(openId || "inbox");
  }, [openId, setOpenListId]);

  useEffect(() => {
    loadItems(openId);
  }, [openId, taskTick]);

  const visible = useMemo(() => {
    const base = isMeeting && mine ? items.filter((item) => item.mine) : items;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => item.text.toLowerCase().includes(q));
  }, [items, isMeeting, mine, query]);

  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const allPicked = visibleIds.length > 0 && visibleIds.every((id) => picked.includes(id));
  const picking = picked.length > 0;

  function togglePick(id: string) {
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  function toggleAllVisible() {
    setPicked(allPicked ? [] : visibleIds);
  }

  async function removePicked() {
    const ids = picked.filter((id) => visibleIds.includes(id));
    if (!ids.length || removing) return;
    if (!confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"}?`)) return;
    setRemoving(true);
    try {
      await Promise.all(
        ids.map((id) => fetch(`${API_URL}/api/items/${id}`, { method: "DELETE" }))
      );
      setPicked([]);
      await loadItems(openId);
      await loadLists();
    } finally {
      setRemoving(false);
    }
  }

  async function saveLink(e: FormEvent) {
    e.preventDefault();
    if (!openId) return;
    const parsed = readRepoLink(repoUrl);
    const organization = (manual ? linkForm.organization : parsed?.organization || "").trim();
    const projectName = (manual ? linkForm.project : parsed?.project || "").trim();
    const repository = (manual ? linkForm.repository : parsed?.repository || "").trim();
    if (!organization || !projectName || !repository) {
      setError("Paste the repository link from Azure DevOps, or fill in the three names.");
      setManual(true);
      return;
    }
    const created = await fetch(`${API_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: repository,
        organization,
        project: projectName,
        repository,
        branch: branch.trim() || "main",
      }),
    });
    if (!created.ok) {
      setError("Could not save that repository.");
      return;
    }
    const project = await created.json();
    const patched = await fetch(`${API_URL}/api/lists/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id }),
    });
    if (!patched.ok) {
      setError("Could not link that list.");
      return;
    }
    setLinking(false);
    setError(null);
    setRepoUrl("");
    await loadLists();
  }

  async function unlinkProject() {
    if (!openId) return;
    await fetch(`${API_URL}/api/lists/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: null }),
    });
    await loadLists();
  }

  async function refreshCode() {
    const projectId = openList?.project?.id;
    if (!projectId || syncing) return;
    setSyncing(true);
    try {
      await fetch(`${API_URL}/api/projects/${projectId}/sync`, { method: "POST" });
      await loadLists();
    } finally {
      setSyncing(false);
    }
  }

  const yours = lists.filter((l) => l.kind !== "meeting");
  const meetings = lists.filter((l) => l.kind === "meeting");

  async function createList(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    const created = await fetch(`${API_URL}/api/lists`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then((r) => r.json());
    setNewTitle("");
    setCreating(false);
    await loadLists();
    if (created?.id) setOpenId(created.id);
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !openId) return;
    await fetch(`${API_URL}/api/lists/${openId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setDraft("");
    await loadItems(openId);
    await loadLists();
  }

  async function removeList(list: TaskList) {
    if (list.kind !== "custom") return;
    if (!confirm(`Delete “${list.title}”?`)) return;
    await fetch(`${API_URL}/api/lists/${list.id}`, { method: "DELETE" });
    if (openId === list.id) setOpenId("inbox");
    await loadLists();
  }

  async function onItemClick(item: ListItem) {
    if (item.status === "open" || item.status === "blocked") {
      const data = await assignWork({ itemId: item.id });
      if (data && "queued" in data && data.queued) {
        const target = pickBestAgent(agents, item.suggested);
        if (target) select(target.id);
      }
      return;
    }
    if (item.agent_id) select(item.agent_id);
  }

  return (
    <aside className="flex h-full min-h-0 w-[320px] shrink-0 flex-col overflow-hidden rounded-[28px] bg-white/70">
      <div className="flex shrink-0 items-center justify-between px-5 py-4">
        <h1 className="text-sm font-semibold tracking-tight">Lists</h1>
        <button type="button" className="btn px-3 py-1 text-xs" onClick={() => setCreating(true)}>
          New list
        </button>
      </div>
      {creating && (
        <form onSubmit={createList} className="shrink-0 px-4 pb-3">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onBlur={() => {
              if (!newTitle.trim()) setCreating(false);
            }}
            placeholder="Name this list"
            className="w-full rounded-full bg-white px-4 py-2 text-sm outline-none"
          />
        </form>
      )}

      <div className="min-h-0 flex-[0.42] overflow-auto">
        {error && <p className="px-5 py-3 text-sm text-[#b42318]">{error}</p>}
        {yours.map((list) => (
          <ListRow
            key={list.id}
            list={list}
            open={openId === list.id}
            onOpen={() => setOpenId(list.id)}
            onDelete={list.kind === "custom" ? () => removeList(list) : undefined}
          />
        ))}
        {meetings.length > 0 && (
          <p className="px-5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ink-soft)]">
            Meetings
          </p>
        )}
        {meetingsFound === false && (
          <p className="px-5 py-3 text-sm text-[var(--ink-soft)]">Meeting notes are not on this machine.</p>
        )}
        {meetings.map((list) => (
          <ListRow
            key={list.id}
            list={list}
            open={openId === list.id}
            onOpen={() => setOpenId(list.id)}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--line)]">
        <div className="shrink-0 px-5 pb-2 pt-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              {visible.length > 0 && (
                <SelectCircle
                  checked={allPicked}
                  label={allPicked ? "Clear selection" : "Select all tasks"}
                  onToggle={toggleAllVisible}
                />
              )}
              <h2 className="min-w-0 truncate text-sm font-semibold tracking-tight">
                {picking ? `${picked.length} selected` : openList?.title || "Tasks"}
              </h2>
            </div>
            {picking ? (
              <button
                type="button"
                className="btn shrink-0 px-3 py-1 text-xs"
                disabled={removing}
                onClick={removePicked}
              >
                Delete
              </button>
            ) : (
              isMeeting && (
                <div className="flex rounded-full bg-[var(--paper-deep)] p-0.5 text-xs">
                  <button
                    type="button"
                    className={`rounded-full px-2.5 py-1 ${mine ? "bg-white shadow-sm" : "text-[var(--ink-soft)]"}`}
                    onClick={() => setMine(true)}
                  >
                    Mine
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-2.5 py-1 ${!mine ? "bg-white shadow-sm" : "text-[var(--ink-soft)]"}`}
                    onClick={() => setMine(false)}
                  >
                    All
                  </button>
                </div>
              )
            )}
          </div>
          {!picking && openList && (
            <div className="mt-1 pl-6">
              {openList.project ? (
                <p className="flex items-center gap-2 text-[11px] text-[var(--ink-soft)]">
                  <span className="min-w-0 truncate">
                    Code from {openList.project.name}
                    {openList.project.branch ? ` · ${openList.project.branch}` : ""}
                  </span>
                  <button type="button" className="shrink-0 underline" disabled={syncing} onClick={refreshCode}>
                    {syncing ? "Refreshing…" : "Refresh"}
                  </button>
                  <button type="button" className="shrink-0 underline" onClick={unlinkProject}>
                    Remove
                  </button>
                </p>
              ) : (
                <button
                  type="button"
                  className="text-[11px] text-[var(--ink-soft)] underline"
                  onClick={() => setLinking((open) => !open)}
                >
                  Connect the code for this list
                </button>
              )}
            </div>
          )}
        </div>
        {openList?.project?.sync_error && (
          <p className="px-5 pb-2 pl-11 text-xs text-[#b42318]">{openList.project.sync_error}</p>
        )}
        {linking && !openList?.project && (
          <form onSubmit={saveLink} className="mx-4 mb-3 shrink-0 rounded-2xl bg-white px-3 py-3">
            <p className="text-sm">Paste the repository link</p>
            <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">
              In Azure DevOps, open the repo and copy the address bar. It looks like
              dev.azure.com/your-company/Stormcast/_git/Stormcast
            </p>
            <input
              autoFocus
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="Paste the link here"
              className="mt-2 w-full rounded-xl bg-[var(--paper)] px-3 py-2 text-sm outline-none"
            />
            {readRepoLink(repoUrl) && (
              <p className="mt-2 text-[11px] text-[var(--ink-soft)]">
                {readRepoLink(repoUrl)?.organization} / {readRepoLink(repoUrl)?.project} /{" "}
                {readRepoLink(repoUrl)?.repository}
              </p>
            )}
            <label className="mt-2 block text-[11px] text-[var(--ink-soft)]">
              Branch, if it is not main
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="mt-1 w-full rounded-xl bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              />
            </label>
            {manual && (
              <div className="mt-2 grid gap-2">
                {(
                  [
                    ["organization", "Company", "The name in dev.azure.com/this-part"],
                    ["project", "Project", "The project that holds the repo, often Stormcast"],
                    ["repository", "Repository", "The Git repo name at the end of the link"],
                  ] as const
                ).map(([key, label, hint]) => (
                  <label key={key} className="text-[11px] text-[var(--ink-soft)]">
                    {label}
                    <span className="mt-0.5 block">{hint}</span>
                    <input
                      value={linkForm[key]}
                      onChange={(e) => setLinkForm((cur) => ({ ...cur, [key]: e.target.value }))}
                      className="mt-1 w-full rounded-xl bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
                    />
                  </label>
                ))}
              </div>
            )}
            <div className="mt-3 flex items-center gap-3">
              <button type="submit" className="btn btn-solid px-3 py-1 text-xs">
                Connect
              </button>
              <button type="button" className="text-[11px] text-[var(--ink-soft)]" onClick={() => setLinking(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="ml-auto text-[11px] text-[var(--ink-soft)] underline"
                onClick={() => setManual((open) => !open)}
              >
                {manual ? "Paste a link instead" : "Type the names"}
              </button>
            </div>
          </form>
        )}
        <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search this list"
            className="mb-2 w-full rounded-full bg-white px-4 py-2 text-sm outline-none"
          />
          {visible.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-[var(--ink-soft)]">
              {openList ? "This list is empty." : "Select a list."}
            </p>
          )}
          {visible.map((item) => {
            const best = pickBestAgent(agents, item.suggested);
            const assigned = agents.find((a) => a.id === item.agent_id);
            const chosen = picked.includes(item.id);
            return (
              <article
                key={item.id}
                draggable={!picking}
                onDragStart={(e) => {
                  (e.currentTarget as HTMLElement).dataset.dragged = "1";
                  e.dataTransfer.setData(TASK_MIME, taskDragPayload(item));
                  e.dataTransfer.setData("text/plain", taskDragPayload(item));
                  e.dataTransfer.effectAllowed = "copy";
                  onDragStrength(item.suggested);
                }}
                onDragEnd={() => onDragStrength(null)}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLElement;
                  if (el.dataset.dragged === "1") {
                    delete el.dataset.dragged;
                    return;
                  }
                  if (picking) {
                    togglePick(item.id);
                    return;
                  }
                  if (item.status === "open" || item.status === "blocked") return;
                  onItemClick(item);
                }}
                className={`mb-2 rounded-2xl px-3 py-3 hover:bg-white ${
                  picking ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                } ${chosen ? "bg-white" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <SelectCircle
                    checked={chosen}
                    label={chosen ? `Deselect ${item.text}` : `Select ${item.text}`}
                    onToggle={() => togglePick(item.id)}
                  />
                  <StatusMark status={item.status} />
                  <p className="line-clamp-2 flex-1 text-sm leading-5">{item.text}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 pl-11">
                  <span className="text-[11px] text-[var(--ink-soft)]">
                    {item.status === "open"
                      ? strengthLabel(item.suggested)
                      : item.status === "done"
                        ? "Done"
                        : item.status === "blocked"
                          ? "Needs attention"
                          : "On a desk"}
                  </span>
                  {(assigned || best) && (
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: (assigned || best)?.pigment || undefined }}
                    >
                      {(assigned || best)?.name}
                    </span>
                  )}
                  {(item.status === "open" || item.status === "blocked") && (
                    <button
                      type="button"
                      className="btn px-2 py-1 text-[11px]"
                      onClick={(e) => {
                        e.stopPropagation();
                        onItemClick(item);
                      }}
                    >
                      Assign
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <form onSubmit={addTask} className="shrink-0 border-t border-[var(--line)] p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task to this list"
            className="w-full rounded-full bg-white px-4 py-2 text-sm outline-none"
          />
        </form>
      </div>
    </aside>
  );
}

function ListRow({
  list,
  open,
  onOpen,
  onDelete,
}: {
  list: TaskList;
  open: boolean;
  onOpen: () => void;
  onDelete?: () => void;
}) {
  const count = list.open_count + list.working_count;
  return (
    <div
      className="flex w-full items-center gap-2 border-b border-[var(--line)] px-3 py-1"
      style={{
        background: open ? "color-mix(in srgb, var(--paper) 70%, white)" : undefined,
      }}
    >
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 px-2 py-2.5 text-left">
        <span className="block truncate text-sm font-medium">{list.title}</span>
      </button>
      <span className="shrink-0 pr-1 text-xs text-[var(--ink-soft)]">{count}</span>
      {onDelete && (
        <button
          type="button"
          className="shrink-0 px-1 text-xs text-[var(--ink-soft)]"
          onClick={onDelete}
          aria-label={`Delete ${list.title}`}
        >
          ×
        </button>
      )}
    </div>
  );
}

function SelectCircle({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={checked}
      draggable={false}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[rgba(28,24,20,0.28)] bg-white"
    >
      {checked ? <span className="block h-2 w-2 rounded-full bg-[var(--ink)]" /> : null}
    </button>
  );
}

function StatusMark({ status }: { status: string }) {
  const mark =
    status === "done" ? "✓" : status === "blocked" ? "!" : status === "working" ? "●" : "○";
  return (
    <span
      className={`mt-0.5 w-4 shrink-0 text-center text-xs ${
        status === "working" ? "animate-pulse" : "text-[var(--ink-soft)]"
      }`}
    >
      {mark}
    </span>
  );
}

export { TASK_MIME as ACTION_MIME };
export { TASK_MIME };
