"""Project memory shared by every desk on that project."""

from __future__ import annotations

from typing import Any

import db

GENERIC = "Couldn't finish that job. Assign it again."


def remember_job(job: dict[str, Any], agent: dict[str, Any], output: str, files: list[str]) -> None:
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
    )


def preamble(project_id: str, skip_job_id: str = "") -> str:
    rows = [row for row in db.list_memories(project_id, limit=12) if row["job_id"] != skip_job_id]
    if not rows:
        return ""
    chunks: list[str] = []
    used = 0
    for row in rows[:8]:
        block = f"{row['agent_name']} ({row['status']}): {row['task']}\n{row['body']}"
        if used and used + len(block) > 6000:
            break
        chunks.append(block)
        used += len(block)
    if not chunks:
        return ""
    return "Earlier on this project\n\n" + "\n\n".join(chunks)


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
