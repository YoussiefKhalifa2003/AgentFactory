"""Project memory shared by every desk on that project."""

from __future__ import annotations

from typing import Any

import db

GENERIC = "Couldn't finish that job. Assign it again."


def remember_job(
    job: dict[str, Any],
    agent: dict[str, Any],
    output: str,
    files: list[str],
    kind: str = "job",
) -> None:
    project_id = str(job.get("project_id") or "")
    body = (output or "").strip()
    if not project_id or not body or body == GENERIC:
        return
    db.remember(
        project_id=project_id,
        job_id=job["id"],
        agent_id=agent["id"],
        agent_name=agent.get("name") or agent["id"],
        task=str(job.get("prompt") or ""),
        status=str(job.get("status") or "done"),
        body=body,
        files=files,
        kind=kind or "job",
    )


def preamble(project_id: str, skip_job_id: str = "") -> str:
    rows = [row for row in db.list_memories(project_id, limit=12) if row["job_id"] != skip_job_id]
    if not rows:
        return ""
    chunks: list[str] = []
    used = 0
    for row in rows[:8]:
        if row.get("kind") == "shift":
            block = f"Shift note: {row['body']}"
        else:
            block = f"{row['agent_name']} ({row['status']}): {row['task']}\n{row['body']}"
        if used and used + len(block) > 6000:
            break
        chunks.append(block)
        used += len(block)
    if not chunks:
        return ""
    return "Earlier on this project\n\n" + "\n\n".join(chunks)


def floor_recap(project_id: str = "", skip_job_id: str = "") -> str:
    lines: list[str] = []
    for job in db.in_flight_jobs():
        if job.get("id") == skip_job_id:
            continue
        if project_id and str(job.get("project_id") or "") != project_id:
            continue
        agent = db.get_agent(str(job.get("agent_id") or ""))
        name = (agent or {}).get("name") or job.get("agent_id") or "Desk"
        caption = (job.get("caption") or job.get("status") or "Working").strip()
        lines.append(f"{name}: {caption}")
        if len(lines) >= 6:
            break
    if not lines:
        return ""
    return "On the floor right now\n  " + "\n  ".join(lines)


def list_for_ui(project_id: str, limit: int = 12) -> list[dict[str, Any]]:
    out = []
    for row in db.list_memories(project_id, limit=limit):
        out.append(
            {
                "id": row.get("id"),
                "job_id": row.get("job_id"),
                "agent_id": row.get("agent_id"),
                "agent_name": row.get("agent_name"),
                "status": row.get("status"),
                "task": row.get("task"),
                "files": row.get("files") or [],
                "kind": row.get("kind") or "job",
                "created_at": row.get("created_at"),
            }
        )
    return out


def recall(project_id: str, query: str) -> str:
    rows = db.search_memories(project_id, query, limit=5)
    if not rows:
        return "no memories"
    parts = []
    for row in rows:
        parts.append(
            f"{row['agent_name']} ({row['status']}): {row['task']}\n{str(row['body'])[:800]}"
        )
    return "\n\n".join(parts)
