"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_URL, ListItem, MemoryRow, Project, Strength, TaskList } from "@/lib/types";
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
  const { agents, assignWork, select, selectedId, taskTick, setOpenListId, openListId, openPreview } = useFactory();
  const [lists, setLists] = useState<TaskList[]>([]);
  const openId = openListId || "inbox";
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const [items, setItems] = useState<ListItem[]>([]);
  const [mine, setMine] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
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
  const [shelf, setShelf] = useState<Project[]>([]);
  const [codeRead, setCodeRead] = useState(true);
  const [ledger, setLedger] = useState<MemoryRow[]>([]);
  const [crewFor, setCrewFor] = useState<string | null>(null);
  const [crewIds, setCrewIds] = useState<string[]>([]);
  const [splitBusy, setSplitBusy] = useState(false);
  const [meetingsOpen, setMeetingsOpen] = useState(false);

  const openList = lists.find((l) => l.id === openId) || null;
  const isMeeting = openList?.kind === "meeting";
  const isDone = openId === "done" || openList?.kind === "done";
  const crewNames = crewIds
    .map((id) => agents.find((a) => a.id === id)?.name)
    .filter(Boolean) as string[];

  async function loadLists() {
    try {
      const data = await fetch(`${API_URL}/api/lists`).then((r) => r.json());
      setLists(data.lists || []);
      setMeetingsFound(data.meetings ? Boolean(data.meetings.found) : null);
      setCodeRead(Boolean(data.code_read));
      setError(null);
      const ids = (data.lists || []).map((l: TaskList) => l.id);
      if (!ids.includes(openIdRef.current)) setOpenListId(data.lists?.[0]?.id || "inbox");
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

  async function loadShelf() {
    try {
      const rows = (await fetch(`${API_URL}/api/projects`).then((r) => r.json())) as Project[];
      setShelf(Array.isArray(rows) ? rows : []);
    } catch {
      setShelf([]);
    }
  }

  useEffect(() => {
    loadLists();
    loadShelf();
    const timer = window.setInterval(() => {
      loadLists();
      loadShelf();
    }, 20000);
    return () => window.clearInterval(timer);
  }, [taskTick]);

  useEffect(() => {
    setPicked([]);
    setCrewFor(null);
    setCrewIds([]);
    if (openList?.kind === "meeting") setMeetingsOpen(true);
  }, [openId, openList?.kind]);

  useEffect(() => {
    loadItems(openId);
  }, [openId, taskTick]);

  useEffect(() => {
    const projectId = openList?.project?.id;
    if (!projectId) {
      setLedger([]);
      return;
    }
    let stop = false;
    fetch(`${API_URL}/api/projects/${projectId}/memory?limit=3`)
      .then((r) => r.json())
      .then((data) => {
        if (!stop) setLedger(Array.isArray(data.items) ? data.items.slice(0, 3) : []);
      })
      .catch(() => {
        if (!stop) setLedger([]);
      });
    return () => {
      stop = true;
    };
  }, [openList?.project?.id, taskTick]);

  const visible = useMemo(() => {
    let base = isMeeting && mine ? items.filter((item) => item.mine) : items;
    if (!isDone) base = base.filter((item) => item.status !== "done");
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((item) => item.text.toLowerCase().includes(q));
  }, [items, isMeeting, isDone, mine, query]);

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
      await Promise.all(ids.map((id) => fetch(`${API_URL}/api/items/${id}`, { method: "DELETE" })));
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
      setLinkError("Paste the repository link from Azure DevOps, or fill in the three names.");
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
      setLinkError("Could not save that repository.");
      return;
    }
    const project = await created.json();
    const patched = await fetch(`${API_URL}/api/lists/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: project.id }),
    });
    if (!patched.ok) {
      setLinkError("Could not link that list.");
      return;
    }
    setLinking(false);
    setLinkError(null);
    setRepoUrl("");
    await loadLists();
    await loadShelf();
  }

  async function attachExisting(projectId: string) {
    if (!openId) return;
    const patched = await fetch(`${API_URL}/api/lists/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId }),
    });
    if (!patched.ok) {
      setLinkError("Could not link that list.");
      return;
    }
    setLinking(false);
    setLinkError(null);
    await loadLists();
    setSyncing(true);
    try {
      await fetch(`${API_URL}/api/projects/${projectId}/sync`, { method: "POST" });
      await loadLists();
    } finally {
      setSyncing(false);
    }
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
    if (created?.id) setOpenListId(created.id);
  }

  async function addTask(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !openId || isDone) return;
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
    if (openId === list.id) setOpenListId("inbox");
    await loadLists();
  }

  async function onItemClick(item: ListItem) {
    if (isDone || item.virtual || item.id.startsWith("done-")) {
      if (item.agent_id) select(item.agent_id);
      if (item.job_id && item.artifact) openPreview(item.job_id, item.artifact);
      return;
    }
    if (item.status === "open" || item.status === "blocked") {
      const desk = agents.find((a) => a.id === selectedId);
      const fallback = pickBestAgent(agents, item.suggested);
      const data = await assignWork({
        itemId: item.id,
        agentId: desk?.id || fallback?.id,
      });
      const fromApi =
        data && typeof data === "object" && "agent" in data
          ? (data as { agent?: { id?: string } }).agent?.id
          : undefined;
      const targetId = fromApi || desk?.id || fallback?.id;
      if (targetId) select(targetId);
      return;
    }
    if (item.agent_id) select(item.agent_id);
  }

  async function assignCrew(item: ListItem) {
    const steps = crewIds
      .map((id) => agents.find((a) => a.id === id))
      .filter(Boolean)
      .slice(0, 4)
      .map((agent) => ({
        agent_id: agent!.id,
        strength: agent!.strengths[0] || "ops",
      }));
    if (!steps.length) return;
    const data = await assignWork({ itemId: item.id, chain: steps });
    const first = steps[0]?.agent_id;
    if (first) select(first);
    setCrewFor(null);
    setCrewIds([]);
    return data;
  }

  async function splitItem(item: ListItem) {
    if (splitBusy) return;
    setSplitBusy(true);
    try {
      await assignWork({ itemId: item.id, foreman: true });
    } finally {
      setSplitBusy(false);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-[28px] bg-white/55 lg:w-[20rem]">
      <div className="flex shrink-0 items-center justify-between px-4 py-3">
        <h1 className="display text-[1.35rem] leading-none">Lists</h1>
        <button type="button" className="btn btn-compact px-3" onClick={() => setCreating(true)} aria-label="New list">
          New
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

      <div className="min-h-0 shrink-0 overflow-auto px-2 pb-1" style={{ maxHeight: meetingsOpen ? "38%" : "10.5rem" }}>
        {error && <p className="px-3 py-3 text-sm text-[#b42318]">{error}</p>}
        {yours.map((list) => (
          <ListRow
            key={list.id}
            list={list}
            open={openId === list.id}
            onOpen={() => setOpenListId(list.id)}
            onDelete={list.kind === "custom" ? () => removeList(list) : undefined}
          />
        ))}
        {meetings.length > 0 && (
          <button
            type="button"
            aria-expanded={meetingsOpen}
            className={`mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-left ${
              meetingsOpen ? "bg-white shadow-sm" : "hover:bg-white/80"
            }`}
            onClick={() => setMeetingsOpen((open) => !open)}
          >
            <span className="w-3 text-[11px] text-[var(--ink-soft)]" aria-hidden>
              {meetingsOpen ? "▾" : "▸"}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--ink)]">
              Meetings
            </span>
            <span className="ml-auto rounded-full bg-[var(--paper)] px-2 py-0.5 text-[11px] text-[var(--ink-soft)]">
              {meetingsOpen ? "Hide" : meetings.length}
            </span>
          </button>
        )}
        {meetingsOpen && meetingsFound === false && (
          <p className="px-3 py-3 text-sm text-[var(--ink-soft)]">Meeting notes are not on this machine.</p>
        )}
        {meetingsOpen &&
          meetings.map((list) => (
            <ListRow key={list.id} list={list} open={openId === list.id} onOpen={() => setOpenListId(list.id)} />
          ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--line)]">
        <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-2.5">
          {picking ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <SelectCircle
                  checked={allPicked}
                  label={allPicked ? "Clear selection" : "Select all tasks"}
                  onToggle={toggleAllVisible}
                />
                <p className="text-sm">{picked.length} selected</p>
              </div>
              <button type="button" className="btn btn-compact px-2.5" disabled={removing} onClick={removePicked}>
                Delete
              </button>
            </>
          ) : (
            <>
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--ink-soft)]">
                  Open list
                </p>
                <p className="truncate text-sm font-medium">{openList?.title || "Inbox"}</p>
                {openList?.project && (
                  <p className="truncate text-[11px] text-[var(--ink-soft)]">
                    {openList.project.title || openList.project.name}
                    {ledger[0] ? ` · ${ledger[0].agent_name}` : ""}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!isDone && openList?.project ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-compact px-2.5"
                      disabled={syncing}
                      onClick={refreshCode}
                    >
                      {syncing ? "Syncing…" : "Sync"}
                    </button>
                    <button type="button" className="btn btn-compact px-2.5" onClick={unlinkProject}>
                      Unlink
                    </button>
                  </>
                ) : !isDone ? (
                  <button
                    type="button"
                    className={`btn btn-compact px-2.5 ${linking ? "btn-solid" : ""}`}
                    aria-pressed={linking}
                    aria-expanded={linking}
                    onClick={() => setLinking((open) => !open)}
                  >
                    {linking ? "Cancel" : "Link code"}
                  </button>
                ) : null}
                {isMeeting && (
                  <div className="flex rounded-full border border-[rgba(28,24,20,0.12)] bg-white p-0.5">
                    <button
                      type="button"
                      className={`btn btn-compact min-h-8 px-2.5 py-1 ${mine ? "btn-solid" : "border-transparent bg-transparent shadow-none"}`}
                      aria-pressed={mine}
                      onClick={() => setMine(true)}
                    >
                      Mine
                    </button>
                    <button
                      type="button"
                      className={`btn btn-compact min-h-8 px-2.5 py-1 ${!mine ? "btn-solid" : "border-transparent bg-transparent shadow-none"}`}
                      aria-pressed={!mine}
                      onClick={() => setMine(false)}
                    >
                      All
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {openList?.project?.sync_error && (
          <p className="px-4 pb-2 text-xs leading-4 text-[#b42318]">{openList.project.sync_error}</p>
        )}
        {linking && !openList?.project && !isDone && (
          <form onSubmit={saveLink} className="mx-4 mb-3 shrink-0 rounded-2xl bg-white px-3 py-3">
            <p className="text-sm">Paste the repository link</p>
            {linkError && <p className="mt-1 text-xs text-[#b42318]">{linkError}</p>}
            {!codeRead && (
              <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">
                The list will still link. To pull files, add AZURE_DEVOPS_PAT to apps/api/.env (same token as Brain), then press Sync.
              </p>
            )}
            {shelf.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {shelf.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    className="rounded-full bg-[var(--paper)] px-2.5 py-1 text-[11px]"
                    onClick={() => attachExisting(project.id)}
                  >
                    {project.title || project.name}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] leading-4 text-[var(--ink-soft)]">
              In Azure DevOps, copy the address bar. It looks like
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
                className="ml-auto text-[11px] text-[var(--ink-soft)]"
                onClick={() => setManual((open) => !open)}
              >
                {manual ? "Paste a link instead" : "Type the names"}
              </button>
            </div>
          </form>
        )}
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-2">
          {items.length > 4 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="mb-2 w-full bg-transparent px-2 py-1 text-sm outline-none"
            />
          )}
          {visible.length === 0 && (
            <p className="px-2 py-8 text-center text-sm text-[var(--ink-soft)]">
              {query ? "No matches." : "Nothing here yet."}
            </p>
          )}
          {visible.map((item) => {
            const assigned = agents.find((a) => a.id === item.agent_id);
            const chosen = picked.includes(item.id);
            const open = item.status === "open" || item.status === "blocked";
            const done = item.status === "done";
            const working = item.status === "working" || item.status === "assigned";
            const crewHere = crewFor === item.id;
            if (isDone) {
              return (
                <article
                  key={item.id}
                  onClick={() => onItemClick(item)}
                  className="group mb-0.5 min-w-0 cursor-pointer rounded-2xl px-2.5 py-2 hover:bg-white/70"
                >
                  <p className="min-w-0 text-sm leading-5 [overflow-wrap:anywhere]">{item.text}</p>
                  <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    {assigned && (
                      <span className="text-[12px] font-medium" style={{ color: assigned.pigment || undefined }}>
                        {assigned.name}
                      </span>
                    )}
                    {item.artifact ? (
                      <span className="text-[12px] text-[var(--ink-soft)]">View</span>
                    ) : item.recap ? (
                      <span className="line-clamp-3 text-[12px] leading-4 text-[var(--ink-soft)]">{item.recap}</span>
                    ) : null}
                  </div>
                </article>
              );
            }
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
                  if (open) return;
                  onItemClick(item);
                }}
                className={`group mb-0.5 min-w-0 rounded-2xl px-2.5 py-2 ${
                  picking ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
                } ${chosen || crewHere ? "bg-white" : "hover:bg-white/70"} ${done ? "opacity-45" : ""}`}
              >
                <div className="flex items-start gap-2">
                  <span className={picking || chosen ? "" : "opacity-40 group-hover:opacity-100"}>
                    <SelectCircle
                      checked={chosen}
                      label={chosen ? `Deselect ${item.text}` : `Select ${item.text}`}
                      onToggle={() => togglePick(item.id)}
                    />
                  </span>
                  <StatusMark status={item.status} />
                  <p className="min-w-0 flex-1 text-sm leading-5 [overflow-wrap:anywhere]">{item.text}</p>
                </div>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5 pl-11">
                  {working && assigned && (
                    <span className="mr-1 text-[12px] font-medium" style={{ color: assigned.pigment || undefined }}>
                      {assigned.name}
                    </span>
                  )}
                  {done && (
                    <span className="mr-1 text-[12px] text-[var(--ink-soft)]">
                      Done{assigned ? ` · ${assigned.name}` : ""}
                    </span>
                  )}
                  {item.status === "blocked" && (
                    <span className="mr-1 text-[12px] text-[#b42318]">Needs attention</span>
                  )}
                  {open && !picking && (
                    <>
                      <button
                        type="button"
                        className="btn btn-compact btn-solid"
                        onClick={(e) => {
                          e.stopPropagation();
                          onItemClick(item);
                        }}
                      >
                        Assign
                      </button>
                      <button
                        type="button"
                        className={`btn btn-compact ${crewHere ? "btn-solid" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setCrewFor((cur) => (cur === item.id ? null : item.id));
                          setCrewIds([]);
                        }}
                      >
                        Crew
                      </button>
                      <button
                        type="button"
                        className="btn btn-compact"
                        disabled={splitBusy}
                        title="Split a 1 / 2 / 3 list onto desks in that order"
                        onClick={(e) => {
                          e.stopPropagation();
                          splitItem(item);
                        }}
                      >
                        Split
                      </button>
                    </>
                  )}
                </div>
                {crewHere && open && (
                  <div className="mt-3 rounded-2xl bg-[var(--paper)] px-3 py-3">
                    <p className="text-[11px] text-[var(--ink-soft)]">
                      Tap desks in order. 1st desk gets item 1, 2nd gets item 2.
                    </p>
                    {crewNames.length > 0 && (
                      <p className="mt-1 text-sm leading-5">{crewNames.join(" → ")}</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {agents.map((agent) => {
                        const on = crewIds.includes(agent.id);
                        const n = crewIds.indexOf(agent.id) + 1;
                        return (
                          <button
                            key={agent.id}
                            type="button"
                            className={`btn btn-compact ${on ? "btn-solid" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setCrewIds((cur) =>
                                on
                                  ? cur.filter((id) => id !== agent.id)
                                  : cur.length >= 4
                                    ? cur
                                    : [...cur, agent.id]
                              );
                            }}
                          >
                            {on ? `${n}. ${agent.name}` : agent.name}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      className="btn btn-solid mt-3 w-full"
                      disabled={crewIds.length === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        assignCrew(item);
                      }}
                    >
                      Hand to crew
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        {!isDone && (
        <form onSubmit={addTask} className="shrink-0 border-t border-[var(--line)] p-3">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task to this list"
            className="w-full rounded-full bg-white px-4 py-2 text-sm outline-none"
          />
        </form>
        )}
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
  const count = list.kind === "done" ? list.item_count : list.open_count + list.working_count;
  return (
    <div className="flex w-full items-center gap-0.5">
      <button
        type="button"
        onClick={onOpen}
        aria-current={open ? "true" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-2xl px-3 py-2 text-left ${
          open ? "bg-[var(--ink)] text-white shadow-sm" : "hover:bg-white"
        }`}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{list.title}</span>
        {count ? (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums ${
              open ? "bg-white/15 text-white" : "bg-white text-[var(--ink-soft)]"
            }`}
          >
            {count}
          </span>
        ) : null}
      </button>
      {onDelete && (
        <button
          type="button"
          className="btn btn-compact h-9 w-9 shrink-0 px-0"
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
      className="relative flex h-11 w-11 shrink-0 items-center justify-center"
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[rgba(28,24,20,0.28)] bg-white">
        {checked ? <span className="block h-2 w-2 rounded-full bg-[var(--ink)]" /> : null}
      </span>
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
