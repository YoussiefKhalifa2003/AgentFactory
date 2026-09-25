"""Handoff chains: Scout then Cade then Hamza, with inherited desk files."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any

import db
import sandbox

VIEW_SUFFIX = {
    ".html",
    ".htm",
    ".mmd",
    ".csv",
    ".pdf",
    ".drawio",
    ".png",
    ".jpg",
    ".jpeg",
    ".svg",
    ".webp",
    ".md",
}
SKIP_NAMES = {"__pycache__", ".git"}
CAP_BYTES = 2_000_000
Broadcast = Any


def inherit_workspace(from_agent: str, from_job: str, to_agent: str, to_job: str) -> list[str]:
    src = sandbox.workspace(from_agent, from_job)
    dest = sandbox.workspace(to_agent, to_job)
    if not src.is_dir():
        return []
    files: list[tuple[int, Path]] = []
    for path in src.rglob("*"):
        if not path.is_file():
            continue
        if any(part in SKIP_NAMES for part in path.parts):
            continue
        if path.suffix.lower() == ".pyc":
            continue
        files.append((path.stat().st_size, path))
    view = [row for row in files if row[1].suffix.lower() in VIEW_SUFFIX]
    other = [row for row in files if row[1].suffix.lower() not in VIEW_SUFFIX]
    copied: list[str] = []
    used = 0
    for size, path in view + other:
        if used + size > CAP_BYTES:
            continue
        rel = path.relative_to(src)
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        copied.append(str(rel).replace("\\", "/"))
        used += size
    return copied


def _step_prompt(item: dict[str, Any], step: dict[str, Any]) -> str:
    extra = (step.get("prompt") or "").strip()
    base = item.get("prompt") or item.get("text") or ""
    if extra and extra != base:
        return extra
    strength = step.get("strength") or ""
    if strength:
        return f"{base}\n\nYour part of this job: {strength}."
    return base


def start_from_assign(
    item: dict[str, Any],
    raw_steps: list[dict[str, Any]],
    created_by: str = "user",
) -> dict[str, Any]:
    steps = _normalize_steps(raw_steps)
    if not steps:
        raise ValueError("chain needs 1 to 4 steps")
    project_id = db.project_for_list(item["list_id"])
    chain = db.create_chain(
        {
            "list_id": item["list_id"],
            "item_id": item["id"],
            "project_id": project_id,
            "title": (item.get("text") or "")[:80],
            "created_by": created_by,
        },
        steps,
    )
    jobs = kick(chain["id"])
    first = jobs[0] if jobs else None
    agent = db.get_agent(first["agent_id"]) if first else None
    return {
        "item": db.get_item(item["id"]),
        "job": first,
        "jobs": jobs,
        "agent": agent,
        "chain": db.get_chain(chain["id"]),
        "queued": False,
        "caption": None,
    }


def _normalize_steps(raw_steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_steps[:4], start=1):
        agent_id = raw.get("agent_id") or None
        strength = (raw.get("strength") or "ops").strip() or "ops"
        depends = raw.get("depends_on")
        if depends is None and i > 1:
            depends = i - 1
        out.append(
            {
                "agent_id": agent_id,
                "strength": strength,
                "prompt": raw.get("prompt") or "",
                "depends_on": depends,
                "inherit": bool(raw.get("inherit", True)),
            }
        )
    return out


def kick(chain_id: str) -> list[dict[str, Any]]:
    chain = db.get_chain(chain_id)
    if not chain or chain.get("status") in {"blocked", "cancelled", "done"}:
        return []
    steps = chain.get("steps") or []
    by_seq = {int(s["seq"]): s for s in steps}
    started: list[dict[str, Any]] = []
    item = db.get_item(str(chain.get("item_id") or "")) if chain.get("item_id") else None
    running = False
    for step in steps:
        if step.get("status") == "running":
            running = True
            continue
        if step.get("status") != "pending":
            continue
        dep = step.get("depends_on")
        if dep is not None:
            prior = by_seq.get(int(dep))
            if not prior or prior.get("status") != "done":
                if prior and prior.get("status") in {"blocked", "cancelled"}:
                    db.update_chain(chain_id, status="blocked")
                continue
        agent_id = step.get("agent_id")
        if not agent_id:
            import lists as board

            picked = board.pick_best_agent(step.get("strength") or "ops")
            agent_id = (picked or {}).get("id")
            if agent_id:
                db.update_chain_step(step["id"], agent_id=agent_id)
        if not agent_id or db.agent_busy(agent_id):
            continue
        if not item:
            continue
        prompt, project_id = _prompt_for_step(item, step, chain)
        claimed = db.claim_or_queue(
            str(agent_id),
            item["id"],
            prompt,
            project_id,
            chain_id=chain_id,
            chain_step_id=step["id"],
        )
        job = claimed.get("job")
        if not job:
            continue
        if step.get("inherit") and dep is not None:
            prior = by_seq.get(int(dep))
            if prior and prior.get("job_id") and prior.get("agent_id"):
                copied = inherit_workspace(
                    str(prior["agent_id"]),
                    str(prior["job_id"]),
                    str(job["agent_id"]),
                    str(job["id"]),
                )
                if copied:
                    try:
                        import harness

                        ws = sandbox.workspace(job["agent_id"], job["id"])
                        agent = db.get_agent(job["agent_id"]) or {"id": job["agent_id"]}
                        harness._collect_artifacts(job, agent, ws, lambda _p: None)
                    except Exception:
                        pass
        db.update_chain_step(step["id"], job_id=job["id"], status="running", agent_id=job["agent_id"])
        db.update_chain(chain_id, status="running")
        started.append(job)
        running = True
    if not running and all(s.get("status") == "done" for s in (db.get_chain(chain_id) or {}).get("steps") or []):
        db.update_chain(chain_id, status="done")
    return started


def _prompt_for_step(item: dict[str, Any], step: dict[str, Any], chain: dict[str, Any]) -> tuple[str, str | None]:
    import lists as board

    prompt, project_id = board._project_prompt(item)
    extra = (step.get("prompt") or "").strip()
    if extra:
        prompt = extra
    else:
        prompt = _step_prompt(item, step)
        if project_id:
            project = db.get_project(project_id)
            title = (project or {}).get("title") or (project or {}).get("name")
            if title:
                marker = f"This task is on the {title} project."
                if marker not in prompt:
                    prompt = prompt.rstrip() + "\n" + marker
    return prompt, project_id or chain.get("project_id")


def kick_open() -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for chain in db.list_open_chains():
        jobs.extend(kick(chain["id"]))
    return jobs


def after_job(job: dict[str, Any], status: str, broadcast: Broadcast | None = None) -> None:
    chain_id = job.get("chain_id")
    if not chain_id:
        return
    step = db.step_for_job(job["id"]) or db.get_chain_step(str(job.get("chain_step_id") or ""))
    if not step:
        return
    mapped = "done" if status == "done" else "blocked" if status == "blocked" else "cancelled"
    db.update_chain_step(step["id"], status=mapped)
    chain = db.get_chain(str(chain_id))
    if not chain:
        return
    if mapped == "done":
        try:
            import memory

            agent = db.get_agent(job["agent_id"]) or {"id": job["agent_id"], "name": job["agent_id"]}
            files = [row["name"] for row in db.list_artifacts(job["id"])]
            memory.remember_job({**job, "status": "done"}, agent, str(job.get("output") or ""), files, kind="handoff")
        except Exception:
            pass
        more = kick(str(chain_id))
        if broadcast:
            for nxt in more:
                broadcast({"type": "job.queued", "job": nxt})
            _emit_chain(str(chain_id), broadcast)
            _start_jobs(more, broadcast)
        chain = db.get_chain(str(chain_id)) or chain
        if all(s.get("status") == "done" for s in chain.get("steps") or []):
            db.update_chain(str(chain_id), status="done")
            if chain.get("item_id"):
                item = db.update_item(str(chain["item_id"]), status="done", job_id=job["id"])
                if broadcast and item:
                    broadcast({"type": "task.updated", "item": item})
        elif chain.get("item_id"):
            item = db.update_item(str(chain["item_id"]), status="working", job_id=job["id"])
            if broadcast and item:
                broadcast({"type": "task.updated", "item": item})
        return
    db.update_chain(str(chain_id), status="blocked")
    if chain.get("item_id"):
        item = db.update_item(str(chain["item_id"]), status="blocked", job_id=job["id"])
        if broadcast and item:
            broadcast({"type": "task.updated", "item": item})
    if broadcast:
        _emit_chain(str(chain_id), broadcast)


def _emit_chain(chain_id: str, broadcast: Broadcast) -> None:
    chain = db.get_chain(chain_id)
    if chain:
        broadcast({"type": "chain.updated", "chain": chain})


def _start_jobs(jobs: list[dict[str, Any]], broadcast: Broadcast) -> None:
    import asyncio

    import harness

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    for job in jobs:
        harness.track_job(job["id"], loop.create_task(harness.run_job(job["id"], broadcast)))
