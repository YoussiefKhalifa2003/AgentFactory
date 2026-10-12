"""Night-shift overlays and win-rate routing. Never rewrites git SKILL.md."""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Any

import db

OVERLAY_CAP = 2500
MIN_N = 3
SECRET = re.compile(r"(AZURE_DEVOPS_PAT|OPENROUTER_API_KEY|OPENCODE_API_KEY|SPARK_API_KEY|\.env\b|FOUNDRY_TOKEN)", re.I)
INFRA = re.compile(
    r"401|403|OPENROUTER|OLLAMA|SPARK_API|missing PAT|unauthorized|timed out|"
    r"unreachable|ZenError|creditserror|freetiererror",
    re.I,
)

_last_coached: list[str] = []
_last_routes: list[str] = []


def overlay_dir(agent_id: str) -> Path:
    path = db.DATA / "skills" / agent_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def overlay_path(agent_id: str, skill_id: str) -> Path:
    safe = "".join(ch for ch in skill_id if ch.isalnum() or ch in "_-") or "ops"
    return overlay_dir(agent_id) / f"{safe}.md"


def overlay_text(agent_id: str, skill_id: str) -> str:
    path = overlay_path(agent_id, skill_id)
    if not path.is_file():
        return ""
    return path.read_text(encoding="utf-8")[:OVERLAY_CAP]


def is_infra(error: str | None, output: str | None = None) -> bool:
    blob = f"{error or ''} {output or ''}"
    return bool(INFRA.search(blob))


def record(agent_id: str, strength: str, model: str, status: str, tokens: int = 0, error: str | None = None) -> None:
    if status not in {"done", "blocked"}:
        return
    if status == "blocked" and is_infra(error):
        return
    db.bump_route_stat(strength or "ops", agent_id, model or "", status, tokens)


def preferred_model(agent_id: str, strength: str) -> str | None:
    rows = db.list_route_stats(agent_id=agent_id, strength=strength)
    total = sum(int(r.get("done") or 0) + int(r.get("blocked") or 0) for r in rows)
    if total < MIN_N or not rows:
        return None
    def score(row: dict[str, Any]) -> float:
        done = int(row.get("done") or 0)
        blocked = int(row.get("blocked") or 0)
        return done / max(1, done + blocked)

    best = max(rows, key=score)
    model = (best.get("model") or "").strip()
    return model or None


def routing_snapshot() -> dict[str, Any]:
    desks: list[dict[str, Any]] = []
    skipped = 0
    for agent in db.list_agents():
        rows = db.list_route_stats(agent_id=agent["id"])
        done = sum(int(r.get("done") or 0) for r in rows)
        blocked = sum(int(r.get("blocked") or 0) for r in rows)
        n = done + blocked
        win = round(done / n, 3) if n else 0
        prefer = preferred_model(agent["id"], (agent.get("strengths") or ["ops"])[0])
        desks.append(
            {
                "id": agent["id"],
                "name": agent["name"],
                "win": win,
                "n": n,
                "preferred": prefer,
            }
        )
    try:
        con = db.connect()
        row = con.execute("SELECT COUNT(*) AS n FROM events WHERE kind=?", ("critic.skipped",)).fetchone()
        skipped = int(row["n"] if row else 0)
        con.close()
    except Exception:
        skipped = 0
    return {"desks": desks, "critic_skipped": skipped}


def _jobs_for_agent(agent_id: str, limit: int = 8) -> list[dict[str, Any]]:
    jobs = [j for j in db.list_jobs(agent_id) if j.get("status") in {"done", "blocked"}]
    jobs.sort(key=lambda j: str(j.get("updated_at") or ""), reverse=True)
    return jobs[:limit]


async def rewrite(agent_id: str) -> str | None:
    agent = db.get_agent(agent_id)
    if not agent:
        return None
    strength = (agent.get("strengths") or ["ops"])[0]
    recent = _jobs_for_agent(agent_id)
    if len(recent) < 2:
        return None
    lines = []
    for job in recent:
        if job.get("status") == "blocked" and is_infra(job.get("error")):
            continue
        flag = "DONE" if job.get("status") == "done" else "BLOCKED"
        prompt = (job.get("prompt") or "")[:240]
        err = (job.get("error") or "")[:180]
        lines.append(f"{flag}: {prompt}\n{err}")
    if not lines:
        return None
    body = (
        "Write at most 12 short coaching bullets for this desk's skill pack. "
        "No secrets, no API keys, no .env, no Azure PAT. Games must mention js/net.js when relevant.\n\n"
        + "\n\n".join(lines)
    )
    text = ""
    try:
        import catalog

        data, _used = await catalog.complete_with_failover(
            agent.get("model") or "",
            [
                {"role": "system", "content": "You write terse skill-pack bullets. No tools. No secrets."},
                {"role": "user", "content": body},
            ],
            None,
        )
        msg = ((data.get("choices") or [{}])[0].get("message") or {})
        text = str(msg.get("content") or "")
    except Exception:
        text = ""
    text = (text or "").strip()
    if not text:
        return None
    if SECRET.search(text):
        return None
    overlay_path(agent_id, strength).write_text(text[:OVERLAY_CAP], encoding="utf-8")
    return agent.get("name") or agent_id


def reset(agent_id: str | None = None) -> None:
    if agent_id:
        folder = db.DATA / "skills" / agent_id
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
        db.clear_route_stats(agent_id)
        return
    root = db.DATA / "skills"
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=True)
    db.clear_route_stats(None)


def morning_line() -> str:
    bits = []
    if _last_coached:
        bits.append("Coached " + ", ".join(_last_coached) + ".")
    if _last_routes:
        bits.append("Routed " + "; ".join(_last_routes) + ".")
    return " ".join(bits)


async def run_shift(shift: dict[str, Any], broadcast: Any = None) -> None:
    global _last_coached, _last_routes
    _last_coached = []
    _last_routes = []
    started = str(shift.get("started_at") or "")
    seen: set[str] = set()
    for job in db.list_jobs():
        if job.get("status") != "blocked":
            continue
        if started and str(job.get("updated_at") or "") < started:
            continue
        if is_infra(job.get("error")):
            continue
        if "You are the critic" in (job.get("prompt") or ""):
            continue
        key = str(job.get("task_id") or job["id"])
        if key in seen:
            continue
        seen.add(key)
        item_id = job.get("task_id")
        if not item_id:
            continue
        try:
            import lists

            db.update_item(str(item_id), status="open", job_id=None)
            result = lists.assign(item_id=str(item_id), agent_id=str(job.get("agent_id") or ""))
            nxt = (result.get("jobs") or [result.get("job")])[0] if result else None
            if nxt:
                try:
                    import chains

                    chains.inherit_workspace(
                        str(job.get("agent_id") or ""),
                        str(job["id"]),
                        str(nxt["agent_id"]),
                        str(nxt["id"]),
                    )
                except Exception:
                    pass
            if nxt and broadcast:
                import harness

                broadcast({"type": "job.queued", "job": nxt})
                harness.track_job(nxt["id"], __import__("asyncio").get_running_loop().create_task(harness.run_job(nxt["id"], broadcast)))
        except Exception:
            continue
    for agent in db.list_agents():
        name = await rewrite(agent["id"])
        if name:
            _last_coached.append(name)
        skill = (agent.get("strengths") or ["ops"])[0]
        prefer = preferred_model(agent["id"], skill)
        if prefer:
            _last_routes.append(f"{skill} → {prefer}")
    note = morning_line()
    if note and shift.get("id"):
        current = (shift.get("note") or "").strip()
        if note not in current:
            db.update_shift(str(shift["id"]), note=(current + " " + note).strip())
