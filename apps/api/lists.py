"""Stored to-do lists, meeting sync, and assignment onto agent desks."""

from __future__ import annotations

import re
from typing import Any

import db
import meetings

DONE_ID = "done"
DONE_LIMIT = 80
_NOISE = re.compile(
    r"server restarted|interrupted|freetiererror|creditserror|payment method|"
    r"opencode\.ai/workspace|only be used from within opencode",
    re.I,
)
_FENCE = re.compile(r"```[\s\S]*?```")
_TASK_LINE = re.compile(r"^(?:Action|Task):\s*(.+)$", re.M)


def pick_best_agent(suggested: str) -> dict[str, Any] | None:
    agents = db.list_agents()
    if not agents:
        return None
    for agent in agents:
        if suggested in (agent.get("strengths") or []):
            return agent
    return agents[0]


def item_prompt(list_title: str, text: str, project_name: str | None = None) -> str:
    line = f"\nThis task is on the {project_name} project." if project_name else ""
    return (
        f'Complete this task from the list "{list_title}".\n'
        f"Task: {text}\n"
        f"{line}\n"
        "Produce the finished deliverable in your reply."
    )


def _project_prompt(item: dict[str, Any]) -> tuple[str, str | None]:
    prompt = item["prompt"]
    project_id = db.project_for_list(item["list_id"])
    if not project_id:
        return prompt, None
    project = db.get_project(project_id)
    if not project:
        return prompt, None
    marker = f"This task is on the {project.get('title') or project['name']} project."
    if marker not in prompt:
        prompt = prompt.rstrip() + "\n" + marker
    return prompt, project_id


def sync_meetings() -> None:
    info = meetings.status()
    if not info.get("found"):
        return
    data = meetings.list_meetings(24)
    for meeting in data.get("meetings") or []:
        list_id = f"mtg-{meeting['id']}"
        existing = db.get_list(list_id)
        if not existing:
            db.create_list(
                {
                    "id": list_id,
                    "title": meeting["title"],
                    "kind": "meeting",
                    "source": str(meeting["id"]),
                    "sort_at": meeting.get("date") or db.utcnow(),
                }
            )
        else:
            db.update_list(
                list_id,
                title=meeting["title"],
                sort_at=meeting.get("date") or existing.get("sort_at"),
            )
        payload = meetings.list_actions(mine=False, meeting_id=meeting["id"], limit=80)
        by_source = {item.get("source"): item for item in db.list_items(list_id)}
        for action in payload.get("actions") or []:
            existing = by_source.get(action["id"])
            if existing:
                if existing.get("status") == "open":
                    db.update_item(
                        existing["id"],
                        suggested=action["suggested"],
                        prompt=action["prompt"],
                        text=action["text"],
                    )
                continue
            db.create_item(
                {
                    "list_id": list_id,
                    "text": action["text"],
                    "prompt": action["prompt"],
                    "suggested": action["suggested"],
                    "source": action["id"],
                    "mine": action.get("mine", True),
                }
            )


def _job_is_noise(job: dict[str, Any]) -> bool:
    output = str(job.get("output") or "").strip()
    if output:
        return False
    blob = f"{job.get('caption') or ''} {job.get('error') or ''} {job.get('output') or ''}"
    return bool(_NOISE.search(blob))


def _task_title(prompt: str, text: str = "") -> str:
    if (text or "").strip():
        return text.strip()
    src = prompt or ""
    match = _TASK_LINE.search(src)
    if match:
        return match.group(1).strip()
    line = (src.split("\n", 1)[0] if src else "Task").strip()
    return line or "Task"


def _is_view_placeholder(text: str) -> bool:
    blob = re.sub(r"\s+", " ", (text or "").strip().lower())
    return blob.endswith("use view.") or blob.endswith("use view")


def _recap(output: str) -> str:
    raw = _FENCE.sub("", output or "").strip()
    if not raw or _is_view_placeholder(raw):
        return ""
    lines = [ln.strip() for ln in raw.splitlines() if ln.strip()]
    clip = " ".join(lines[:3])
    if len(clip) > 220:
        return clip[:217].rstrip() + "…"
    return clip


def _best_artifact(arts: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not arts:
        return None

    def rank(row: dict[str, Any]) -> int:
        name = str(row.get("name") or "").lower()
        kind = str(row.get("kind") or "")
        if kind == "site" or name.endswith((".html", ".htm")):
            return 0
        if name.endswith(".mmd"):
            return 1
        if name.endswith("review.md"):
            return 6
        if kind == "sheet" or name.endswith(".csv"):
            return 2
        if kind == "pack" or name.endswith(".pdf"):
            return 3
        if name.endswith(".drawio"):
            return 4
        if kind == "plot" or name.endswith((".png", ".jpg", ".jpeg", ".svg", ".webp")):
            return 5
        return 9

    viewable = [row for row in arts if rank(row) < 9]
    if not viewable:
        return None
    viewable.sort(key=rank)
    return viewable[0]


def _done_jobs() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for job in db.list_jobs():
        if job.get("status") != "done":
            continue
        if _job_is_noise(job):
            continue
        out.append(job)
        if len(out) >= DONE_LIMIT:
            break
    return out


def _job_as_item(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"{DONE_ID}-{job['id']}",
        "list_id": DONE_ID,
        "text": _task_title(str(job.get("prompt") or "")),
        "prompt": job.get("prompt") or "",
        "suggested": "ops",
        "status": "done",
        "agent_id": job.get("agent_id"),
        "job_id": job["id"],
        "source": None,
        "mine": True,
        "virtual": True,
        "recap": _recap(str(job.get("output") or "")),
        "artifact": _best_artifact(job.get("artifacts") or []),
    }


def _done_items() -> list[dict[str, Any]]:
    return [_job_as_item(job) for job in _done_jobs()]


def _done_meta(count: int | None = None) -> dict[str, Any]:
    n = len(_done_jobs()) if count is None else count
    return {
        "id": DONE_ID,
        "title": "Done",
        "kind": "done",
        "source": None,
        "project_id": None,
        "project": None,
        "sort_at": None,
        "item_count": n,
        "open_count": 0,
        "working_count": 0,
        "done_count": n,
    }


def _inject_done(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    done = _done_meta()
    out: list[dict[str, Any]] = []
    inserted = False
    for row in rows:
        out.append(row)
        if row.get("id") == "inbox" or row.get("kind") == "inbox":
            out.append(done)
            inserted = True
    if not inserted:
        out.insert(0, done)
    return out


def snapshot() -> dict[str, Any]:
    import repos

    sync_meetings()
    return {
        "lists": _inject_done(db.list_lists()),
        "meetings": meetings.status(),
        "code_read": repos.has_pat(),
    }


def get_list_payload(list_id: str) -> dict[str, Any] | None:
    if list_id == DONE_ID:
        items = _done_items()
        return {**_done_meta(len(items)), "items": items}
    sync_meetings()
    row = db.get_list(list_id)
    if not row:
        return None
    items = db.list_items(list_id)
    row.update(db._list_counts(list_id))
    row["project"] = db._public_project(row.get("project_id"))
    return {**row, "items": items}


def add_item(list_id: str, text: str) -> dict[str, Any]:
    if list_id == DONE_ID:
        raise ValueError("that list cannot take items")
    lst = db.get_list(list_id)
    if not lst:
        raise KeyError("list not found")
    body = text.strip()
    if not body:
        raise ValueError("text required")
    suggested = meetings._suggest_strength(body)
    project_id = db.project_for_list(list_id)
    project = db.get_project(project_id) if project_id else None
    return db.create_item(
        {
            "list_id": list_id,
            "text": body,
            "prompt": item_prompt(lst["title"], body, (project or {}).get("name")),
            "suggested": suggested,
            "mine": True,
        }
    )


def start_next(agent_id: str) -> dict[str, Any] | None:
    if db.agent_busy(agent_id):
        return None
    item = db.next_queued_item(agent_id)
    if not item:
        return None
    agent = db.get_agent(agent_id)
    if not agent:
        return None
    prompt, project_id = _project_prompt(item)
    claimed = db.claim_or_queue(agent_id, item["id"], prompt, project_id)
    return {
        "item": claimed.get("item"),
        "job": claimed.get("job"),
        "agent": agent,
        "queued": bool(claimed.get("queued")),
    }


def assign(
    *,
    item_id: str | None = None,
    list_id: str | None = None,
    text: str | None = None,
    agent_id: str | None = None,
    chain: list[dict[str, Any]] | None = None,
    foreman: bool = False,
) -> dict[str, Any]:
    if list_id == DONE_ID or (item_id and str(item_id).startswith(f"{DONE_ID}-")):
        raise ValueError("done items cannot be assigned")
    item = db.get_item(item_id) if item_id else None
    if item is not None and (item.get("list_id") == DONE_ID or item.get("virtual")):
        raise ValueError("done items cannot be assigned")
    if item is None and text:
        target_list = list_id or "inbox"
        if not db.get_list(target_list):
            db.seed_inbox()
            target_list = "inbox"
        item = add_item(target_list, text)
    if not item:
        raise KeyError("item not found")

    if item["status"] in {"assigned", "working"} and item.get("job_id"):
        job = db.get_job(item["job_id"])
        if job and job["status"] in {"queued", "thinking", "tool"}:
            agent = db.get_agent(job["agent_id"])
            return {"item": item, "job": job, "agent": agent, "queued": False}

    if chain:
        import chains as crew
        import critic as eyes_last
        import foreman as boss

        parts = boss.split_task_list(item.get("text") or item.get("prompt") or "")
        steps = [dict(step) for step in chain]
        if len(parts) >= 2:
            steps = boss.apply_list_to_chain(steps, parts)
        steps = eyes_last.inject_steps(steps, item.get("text") or item.get("prompt") or "")
        return crew.start_from_assign(item, steps, created_by="user")

    if foreman:
        import chains as crew
        import critic as eyes_last
        import foreman as boss

        steps = boss.plan(item.get("text") or item.get("prompt") or "")
        if len(steps) >= 2:
            steps = eyes_last.inject_steps(steps, item.get("text") or item.get("prompt") or "")
            result = crew.start_from_assign(item, steps, created_by="foreman")
            caption = boss.caption_for(steps)
            result["caption"] = caption
            if caption and result.get("chain"):
                db.update_chain(result["chain"]["id"], title=caption)
                result["chain"] = db.get_chain(result["chain"]["id"])
            return result
        if steps:
            agent_id = steps[0].get("agent_id") or agent_id

    suggested = item.get("suggested") or "coding"
    agent = db.get_agent(agent_id) if agent_id else pick_best_agent(suggested)
    if not agent:
        raise LookupError("no agent")

    prompt, project_id = _project_prompt(item)
    import critic as eyes_last
    import strengths as skillset

    primary = "ops"
    domain = skillset.ids()
    for skill in agent.get("strengths") or []:
        if skill in domain:
            primary = skill
            break
    if primary in eyes_last.SERIOUS:
        steps = [
            {
                "agent_id": agent["id"],
                "strength": primary,
                "prompt": "",
                "inherit": False,
            }
        ]
        injected = eyes_last.inject_steps(steps, prompt)
        if len(injected) > 1:
            import chains as crew

            return crew.start_from_assign(item, injected, created_by="user")
    claimed = db.claim_or_queue(agent["id"], item["id"], prompt, project_id)
    return {
        "item": claimed.get("item") or item,
        "job": claimed.get("job"),
        "agent": agent,
        "queued": bool(claimed.get("queued")),
    }
