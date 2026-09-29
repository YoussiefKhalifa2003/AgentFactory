"""Desk strengths and addable tool skills (skills/*/SKILL.md)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

SKILLS = Path(__file__).resolve().parent.parents[1] / "skills"
_FRONT = re.compile(r"^---\s*\n(.*?)\n---\s*\n?", re.S)

CATALOG: list[dict[str, str]] = [
    {"id": "coding", "label": "Coding", "copy": "Writes files and runs them"},
    {"id": "maths", "label": "Maths", "copy": "Checks every answer in code"},
    {"id": "research", "label": "Research", "copy": "Looks things up and cites them"},
    {"id": "writing", "label": "Writing", "copy": "Drafts, emails, docs, one-pagers"},
    {"id": "data", "label": "Data", "copy": "Tables, metrics, dashboards"},
    {"id": "planning", "label": "Planning", "copy": "Plans, roadmaps, breakdowns"},
    {"id": "ops", "label": "Ops", "copy": "Follow-ups, process, coordination"},
    {"id": "review", "label": "Review", "copy": "Findings, severity, what to fix"},
    {"id": "brief", "label": "Brief", "copy": "Situation, so-what, one ask"},
    {"id": "qa", "label": "QA", "copy": "Writes tests and runs them"},
]

MAX_STRENGTHS = 2
MAX_TOOLS = 8


def ids() -> set[str]:
    return {row["id"] for row in CATALOG}


def _parse_front(raw: str) -> tuple[dict[str, str], str]:
    meta: dict[str, str] = {}
    match = _FRONT.match(raw or "")
    if not match:
        return meta, raw
    for line in match.group(1).splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        meta[key.strip().lower()] = value.strip().strip("\"'")
    return meta, (raw[match.end() :] if match else raw).lstrip()


def _read_pack(skill_id: str) -> dict[str, str] | None:
    path = SKILLS / skill_id / "SKILL.md"
    if not path.is_file():
        return None
    meta, body = _parse_front(path.read_text(encoding="utf-8"))
    return {
        "id": skill_id,
        "kind": (meta.get("kind") or "strength").lower(),
        "label": meta.get("label") or skill_id.replace("_", " "),
        "copy": meta.get("description") or meta.get("copy") or "",
        "body": body,
    }


def list_tools() -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not SKILLS.is_dir():
        return out
    domain = ids()
    for path in sorted(SKILLS.iterdir()):
        if not path.is_dir() or path.name in domain:
            continue
        pack = _read_pack(path.name)
        if not pack or pack["kind"] != "tool":
            continue
        out.append({"id": pack["id"], "label": pack["label"], "copy": pack["copy"]})
    return out


def tool_ids() -> set[str]:
    return {row["id"] for row in list_tools()}


def pack_body(skill_id: str) -> str:
    pack = _read_pack(skill_id)
    return pack["body"] if pack else ""


def has_tool(agent: dict[str, Any] | None, name: str) -> bool:
    return name in ((agent or {}).get("strengths") or [])


def clamp(values: list[str] | str | None, fallback: str = "coding") -> list[str]:
    if isinstance(values, str):
        values = [values]
    domain_ids = ids()
    extra_ids = tool_ids()
    domain: list[str] = []
    tools: list[str] = []
    for value in values or []:
        if value in domain_ids and value not in domain and len(domain) < MAX_STRENGTHS:
            domain.append(value)
        elif value in extra_ids and value not in tools and len(tools) < MAX_TOOLS:
            tools.append(value)
    return (domain or [fallback]) + tools


def snapshot() -> dict[str, Any]:
    return {"strengths": CATALOG, "tools": list_tools()}
