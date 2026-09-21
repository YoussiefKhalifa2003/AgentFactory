"""SQLite persistence for Foundry agents, jobs, events, artifacts."""

from __future__ import annotations

import json
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import strengths as skillset
import zen

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
DATA = REPO / ".run"
OLD_DATA = ROOT / "data"
DB_PATH = DATA / "foundry.db"
WORKSPACES = DATA / "workspaces"
PFPS = DATA / "pfps"

_lock = threading.Lock()


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    WORKSPACES.mkdir(parents=True, exist_ok=True)
    PFPS.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


def init_db() -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    WORKSPACES.mkdir(parents=True, exist_ok=True)
    PFPS.mkdir(parents=True, exist_ok=True)
    if OLD_DATA.exists() and not DB_PATH.exists():
        shutil.copytree(OLD_DATA, DATA, dirs_exist_ok=True)
    with _lock:
        con = connect()
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS agents (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                pigment TEXT NOT NULL,
                pfp TEXT,
                strengths TEXT NOT NULL,
                model TEXT NOT NULL,
                instructions TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                prompt TEXT NOT NULL,
                status TEXT NOT NULL,
                activity TEXT NOT NULL DEFAULT 'idle',
                caption TEXT NOT NULL DEFAULT '',
                output TEXT NOT NULL DEFAULT '',
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(agent_id) REFERENCES agents(id)
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS artifacts (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL,
                agent_id TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                mime TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS lists (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                kind TEXT NOT NULL DEFAULT 'custom',
                source TEXT,
                sort_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS list_items (
                id TEXT PRIMARY KEY,
                list_id TEXT NOT NULL,
                text TEXT NOT NULL,
                prompt TEXT NOT NULL,
                suggested TEXT NOT NULL DEFAULT 'coding',
                status TEXT NOT NULL DEFAULT 'open',
                agent_id TEXT,
                job_id TEXT,
                source TEXT,
                mine INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(list_id) REFERENCES lists(id)
            );
            """
        )
        _ensure_column(con, "jobs", "task_id", "TEXT")
        con.commit()
        con.close()
    seed_starters()
    seed_inbox()
    remap_free_models()
    recover_stuck_jobs()


def _ensure_column(con: sqlite3.Connection, table: str, name: str, decl: str) -> None:
    cols = {row[1] for row in con.execute(f"PRAGMA table_info({table})").fetchall()}
    if name not in cols:
        con.execute(f"ALTER TABLE {table} ADD COLUMN {name} {decl}")


def _row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    d = dict(r)
    if "strengths" in d and isinstance(d["strengths"], str):
        try:
            d["strengths"] = json.loads(d["strengths"])
        except json.JSONDecodeError:
            d["strengths"] = []
    return d


def list_agents() -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute("SELECT * FROM agents ORDER BY created_at").fetchall()
    con.close()
    return [_row(r) for r in rows]  # type: ignore[misc]


def get_agent(agent_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM agents WHERE id=?", (agent_id,)).fetchone()
    con.close()
    return _row(row)


def create_agent(payload: dict[str, Any]) -> dict[str, Any]:
    agent_id = payload.get("id") or str(uuid.uuid4())
    now = utcnow()
    strengths = skillset.clamp(payload.get("strengths") or ["coding"])
    model = payload.get("model") or default_model_for(strengths)
    with _lock:
        con = connect()
        con.execute(
            """
            INSERT INTO agents (id, name, description, pigment, pfp, strengths, model, instructions, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                agent_id,
                payload["name"].strip(),
                payload.get("description", "").strip(),
                payload.get("pigment") or pigment_from_name(payload["name"]),
                payload.get("pfp"),
                json.dumps(strengths),
                model,
                payload.get("instructions") or "",
                now,
            ),
        )
        con.commit()
        con.close()
    agent = get_agent(agent_id)
    assert agent
    return agent


def update_agent(agent_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    current = get_agent(agent_id)
    if not current:
        return None
    strengths = skillset.clamp(payload.get("strengths", current["strengths"]))
    model = payload["model"] if payload.get("model") else current["model"]
    with _lock:
        con = connect()
        con.execute(
            """
            UPDATE agents SET name=?, description=?, pigment=?, pfp=?, strengths=?, model=?, instructions=?
            WHERE id=?
            """,
            (
                payload.get("name", current["name"]),
                payload.get("description", current["description"]),
                payload.get("pigment", current["pigment"]),
                payload.get("pfp", current["pfp"]),
                json.dumps(strengths),
                model,
                payload.get("instructions", current["instructions"]),
                agent_id,
            ),
        )
        con.commit()
        con.close()
    return get_agent(agent_id)


def delete_agent(agent_id: str) -> bool:
    agent = get_agent(agent_id)
    if not agent:
        return False
    with _lock:
        con = connect()
        jobs = [
            r[0]
            for r in con.execute("SELECT id FROM jobs WHERE agent_id=?", (agent_id,)).fetchall()
        ]
        for job_id in jobs:
            con.execute("DELETE FROM artifacts WHERE job_id=?", (job_id,))
            con.execute("DELETE FROM events WHERE job_id=?", (job_id,))
        con.execute("DELETE FROM jobs WHERE agent_id=?", (agent_id,))
        con.execute("DELETE FROM agents WHERE id=?", (agent_id,))
        con.commit()
        con.close()
    ws = WORKSPACES / agent_id
    if ws.exists():
        shutil.rmtree(ws, ignore_errors=True)
    pfp = agent.get("pfp") or ""
    if pfp.startswith("/pfps/"):
        path = PFPS / Path(pfp).name
        if path.exists():
            path.unlink(missing_ok=True)
    return True


def recover_stuck_jobs() -> None:
    """Reload kills in-flight harness tasks; don't leave bays spinning forever."""
    with _lock:
        con = connect()
        con.execute(
            """
            UPDATE jobs
            SET status='blocked', activity='blocked',
                caption='Interrupted — send the job again',
                error='The server restarted while this job was running.',
                updated_at=?
            WHERE status IN ('queued', 'thinking', 'tool')
            """,
            (utcnow(),),
        )
        con.commit()
        con.close()


def list_jobs(agent_id: str | None = None) -> list[dict[str, Any]]:
    con = connect()
    if agent_id:
        rows = con.execute(
            "SELECT * FROM jobs WHERE agent_id=? ORDER BY created_at DESC",
            (agent_id,),
        ).fetchall()
    else:
        rows = con.execute("SELECT * FROM jobs ORDER BY created_at DESC").fetchall()
    jobs = [dict(r) for r in rows]
    ids = [j["id"] for j in jobs]
    arts: dict[str, list[dict[str, Any]]] = {jid: [] for jid in ids}
    if ids:
        q = ",".join("?" * len(ids))
        for row in con.execute(
            f"SELECT * FROM artifacts WHERE job_id IN ({q}) ORDER BY created_at",
            ids,
        ):
            item = dict(row)
            arts.setdefault(item["job_id"], []).append(item)
    con.close()
    for job in jobs:
        job["artifacts"] = arts.get(job["id"], [])
    return jobs


def get_job(job_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
    con.close()
    return dict(row) if row else None


def create_job(agent_id: str, prompt: str, task_id: str | None = None) -> dict[str, Any]:
    job_id = str(uuid.uuid4())
    now = utcnow()
    with _lock:
        con = connect()
        con.execute(
            """
            INSERT INTO jobs (id, agent_id, prompt, status, activity, caption, output, created_at, updated_at, task_id)
            VALUES (?, ?, ?, 'queued', 'idle', 'Queued on the floor', '', ?, ?, ?)
            """,
            (job_id, agent_id, prompt, now, now, task_id),
        )
        con.commit()
        con.close()
    job = get_job(job_id)
    assert job
    return job


def update_job(job_id: str, **fields: Any) -> dict[str, Any] | None:
    fields["updated_at"] = utcnow()
    keys = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [job_id]
    with _lock:
        con = connect()
        con.execute(f"UPDATE jobs SET {keys} WHERE id=?", vals)
        con.commit()
        con.close()
    return get_job(job_id)


def add_event(job_id: str, kind: str, payload: dict[str, Any]) -> None:
    with _lock:
        con = connect()
        con.execute(
            "INSERT INTO events (job_id, kind, payload, created_at) VALUES (?, ?, ?, ?)",
            (job_id, kind, json.dumps(payload), utcnow()),
        )
        con.commit()
        con.close()


def list_events(job_id: str) -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute(
        "SELECT * FROM events WHERE job_id=? ORDER BY id", (job_id,)
    ).fetchall()
    con.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["payload"] = json.loads(d["payload"])
        except json.JSONDecodeError:
            pass
        out.append(d)
    return out


def add_artifact(
    job_id: str, agent_id: str, name: str, kind: str, path: str, mime: str | None = None
) -> dict[str, Any]:
    art_id = str(uuid.uuid4())
    with _lock:
        con = connect()
        con.execute(
            """
            INSERT INTO artifacts (id, job_id, agent_id, name, kind, path, mime, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (art_id, job_id, agent_id, name, kind, path, mime, utcnow()),
        )
        con.commit()
        con.close()
    return {
        "id": art_id,
        "job_id": job_id,
        "agent_id": agent_id,
        "name": name,
        "kind": kind,
        "path": path,
        "mime": mime,
    }


def list_artifacts(job_id: str) -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute(
        "SELECT * FROM artifacts WHERE job_id=? ORDER BY created_at", (job_id,)
    ).fetchall()
    con.close()
    return [dict(r) for r in rows]


def pigment_from_name(name: str) -> str:
    hues = [
        "#D46A3A",
        "#1AA6B8",
        "#7C5CDB",
        "#C45C8A",
        "#3D8B5F",
        "#C9A227",
        "#2F6FED",
        "#E25B4A",
    ]
    return hues[sum(ord(c) for c in name) % len(hues)]


def default_model_for(strengths: list[str]) -> str:
    import catalog

    return catalog.default_model_id()


def failover_models(primary: str) -> list[str]:
    import catalog

    return catalog.failover_chain(primary)


def skill_text(strength: str) -> str:
    return skillset.pack_body(strength)


def seed_starters() -> None:
    if list_agents():
        return
    starters = [
        {
            "id": "ada",
            "name": "Ada",
            "description": "Writes and runs code on the floor. Tests before she calls it done.",
            "pigment": "#D46A3A",
            "strengths": ["coding"],
            "model": "big-pickle",
            "instructions": "You are Ada, Foundry's coding specialist. Short, precise, run the code.",
        },
        {
            "id": "euclid",
            "name": "Euclid",
            "description": "Maths and reasoning. Every answer is checked in SymPy.",
            "pigment": "#1AA6B8",
            "strengths": ["maths"],
            "model": "big-pickle",
            "instructions": "You are Euclid. Prove it in code. No unchecked closed forms.",
        },
        {
            "id": "scout",
            "name": "Scout",
            "description": "Research runner. Fetches sources and cites them.",
            "pigment": "#7C5CDB",
            "strengths": ["research"],
            "model": "big-pickle",
            "instructions": "You are Scout. Fetch real pages. Cite what you read.",
        },
    ]
    for s in starters:
        create_agent(s)
    remap_free_models()


def remap_free_models() -> None:
    import catalog

    known = catalog.known_ids()
    for agent in list_agents():
        model = agent.get("model") or ""
        if not model:
            update_agent(agent["id"], {"model": catalog.default_model_id()})
            continue
        if model in known or model.startswith(("openrouter:", "local:", "ollama:")):
            continue
        if model in zen.CHAT_MODELS:
            continue
        update_agent(agent["id"], {"model": catalog.default_model_id()})


def agent_busy(agent_id: str) -> bool:
    con = connect()
    row = con.execute(
        """
        SELECT id FROM jobs
        WHERE agent_id=? AND status IN ('queued', 'thinking', 'tool')
        LIMIT 1
        """,
        (agent_id,),
    ).fetchone()
    con.close()
    return row is not None


def seed_inbox() -> None:
    if get_list("inbox"):
        return
    create_list({"id": "inbox", "title": "Inbox", "kind": "inbox"})


def get_list(list_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM lists WHERE id=?", (list_id,)).fetchone()
    con.close()
    return dict(row) if row else None


def list_lists() -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute(
        """
        SELECT * FROM lists
        ORDER BY CASE kind WHEN 'inbox' THEN 0 WHEN 'custom' THEN 1 ELSE 2 END,
                 sort_at DESC
        """
    ).fetchall()
    con.close()
    out = []
    for row in rows:
        item = dict(row)
        item.update(_list_counts(item["id"]))
        out.append(item)
    return out


def _list_counts(list_id: str) -> dict[str, int]:
    con = connect()
    rows = con.execute(
        "SELECT status FROM list_items WHERE list_id=?", (list_id,)
    ).fetchall()
    con.close()
    statuses = [r[0] for r in rows]
    return {
        "item_count": len(statuses),
        "open_count": sum(1 for s in statuses if s in {"open", "blocked"}),
        "working_count": sum(1 for s in statuses if s in {"assigned", "working"}),
        "done_count": sum(1 for s in statuses if s == "done"),
    }


def create_list(payload: dict[str, Any]) -> dict[str, Any]:
    list_id = payload.get("id") or str(uuid.uuid4())
    now = utcnow()
    with _lock:
        con = connect()
        con.execute(
            """
            INSERT INTO lists (id, title, kind, source, sort_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                list_id,
                payload["title"].strip(),
                payload.get("kind") or "custom",
                payload.get("source"),
                payload.get("sort_at") or now,
                now,
            ),
        )
        con.commit()
        con.close()
    row = get_list(list_id)
    assert row
    return row


def update_list(list_id: str, **fields: Any) -> dict[str, Any] | None:
    if not fields:
        return get_list(list_id)
    keys = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [list_id]
    with _lock:
        con = connect()
        con.execute(f"UPDATE lists SET {keys} WHERE id=?", vals)
        con.commit()
        con.close()
    return get_list(list_id)


def delete_list(list_id: str) -> bool:
    row = get_list(list_id)
    if not row or row["kind"] != "custom":
        return False
    with _lock:
        con = connect()
        con.execute("DELETE FROM list_items WHERE list_id=?", (list_id,))
        con.execute("DELETE FROM lists WHERE id=?", (list_id,))
        con.commit()
        con.close()
    return True


def _item_row(r: sqlite3.Row | None) -> dict[str, Any] | None:
    if r is None:
        return None
    d = dict(r)
    d["mine"] = bool(d.get("mine", 1))
    return d


def get_item(item_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM list_items WHERE id=?", (item_id,)).fetchone()
    con.close()
    return _item_row(row)


def get_item_by_job(job_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM list_items WHERE job_id=?", (job_id,)).fetchone()
    con.close()
    return _item_row(row)


def get_item_by_source(source: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute("SELECT * FROM list_items WHERE source=?", (source,)).fetchone()
    con.close()
    return _item_row(row)


def list_items(list_id: str) -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute(
        "SELECT * FROM list_items WHERE list_id=? ORDER BY created_at",
        (list_id,),
    ).fetchall()
    con.close()
    return [_item_row(r) for r in rows]  # type: ignore[misc]


def items_for_agent(agent_id: str) -> list[dict[str, Any]]:
    con = connect()
    rows = con.execute(
        """
        SELECT * FROM list_items
        WHERE agent_id=? AND status IN ('assigned', 'working', 'blocked')
        ORDER BY created_at
        """,
        (agent_id,),
    ).fetchall()
    con.close()
    return [_item_row(r) for r in rows]  # type: ignore[misc]


def create_item(payload: dict[str, Any]) -> dict[str, Any]:
    item_id = payload.get("id") or str(uuid.uuid4())
    now = utcnow()
    with _lock:
        con = connect()
        con.execute(
            """
            INSERT INTO list_items (
                id, list_id, text, prompt, suggested, status,
                agent_id, job_id, source, mine, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item_id,
                payload["list_id"],
                payload["text"].strip(),
                payload.get("prompt") or payload["text"].strip(),
                payload.get("suggested") or "coding",
                payload.get("status") or "open",
                payload.get("agent_id"),
                payload.get("job_id"),
                payload.get("source"),
                1 if payload.get("mine", True) else 0,
                now,
                now,
            ),
        )
        con.commit()
        con.close()
    row = get_item(item_id)
    assert row
    return row


def update_item(item_id: str, **fields: Any) -> dict[str, Any] | None:
    if not get_item(item_id):
        return None
    fields["updated_at"] = utcnow()
    keys = ", ".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [item_id]
    with _lock:
        con = connect()
        con.execute(f"UPDATE list_items SET {keys} WHERE id=?", vals)
        con.commit()
        con.close()
    return get_item(item_id)


def delete_item(item_id: str) -> bool:
    if not get_item(item_id):
        return False
    with _lock:
        con = connect()
        con.execute("DELETE FROM list_items WHERE id=?", (item_id,))
        con.commit()
        con.close()
    return True


def mark_item_for_job(job_id: str, status: str) -> dict[str, Any] | None:
    job = get_job(job_id)
    item = None
    if job and job.get("task_id"):
        item = get_item(str(job["task_id"]))
    if not item:
        item = get_item_by_job(job_id)
    if not item:
        return None
    payload: dict[str, Any] = {"status": status, "job_id": job_id}
    if job:
        payload["agent_id"] = job["agent_id"]
    return update_item(item["id"], **payload)


def next_queued_item(agent_id: str) -> dict[str, Any] | None:
    con = connect()
    row = con.execute(
        """
        SELECT * FROM list_items
        WHERE agent_id=? AND status='assigned' AND (job_id IS NULL OR job_id='')
        ORDER BY created_at
        LIMIT 1
        """,
        (agent_id,),
    ).fetchone()
    con.close()
    return _item_row(row)
