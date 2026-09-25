"""Stored to-do lists, meeting sync, and assignment onto agent desks."""

from __future__ import annotations

from typing import Any

import db
import meetings


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


def snapshot() -> dict[str, Any]:
    sync_meetings()
    return {
        "lists": db.list_lists(),
        "meetings": meetings.status(),
    }


def get_list_payload(list_id: str) -> dict[str, Any] | None:
    sync_meetings()
    row = db.get_list(list_id)
    if not row:
        return None
    items = db.list_items(list_id)
    row.update(db._list_counts(list_id))
    row["project"] = db._public_project(row.get("project_id"))
    return {**row, "items": items}


def add_item(list_id: str, text: str) -> dict[str, Any]:
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
    item = db.get_item(item_id) if item_id else None
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

        return crew.start_from_assign(item, [dict(step) for step in chain], created_by="user")

    if foreman:
        import chains as crew
        import foreman as boss

        steps = boss.plan(item.get("text") or item.get("prompt") or "")
        if len(steps) >= 2:
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
    claimed = db.claim_or_queue(agent["id"], item["id"], prompt, project_id)
    return {
        "item": claimed.get("item") or item,
        "job": claimed.get("job"),
        "agent": agent,
        "queued": bool(claimed.get("queued")),
    }
