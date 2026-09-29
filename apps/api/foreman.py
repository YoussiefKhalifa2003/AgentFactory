"""Rules-only Foreman. Splits a job onto desks. Does not write files."""

from __future__ import annotations

import re
from typing import Any

import db
import meetings

CONNECTOR = re.compile(r"\b(?:and|then|plus)\b|,", re.I)
PAGE = re.compile(r"\b(page|website|html|site)\b", re.I)
_NUMBERED_LINE = re.compile(
    r"^\s*(?:\d+[\.\)\:]|\(\d+\)|[-*\u2022])\s+(\S.+?)\s*$",
    re.M,
)
_NUMBERED_INLINE = re.compile(r"(?:^|\s)\d+[\.\)\:]\s+")
_CLAUSE = re.compile(
    r"\s*,\s*(?:and\s+)?|\s+;\s+|\s+\bthen\b\s+|\s+\band then\b\s+",
    re.I,
)
ORDER = [
    "research",
    "review",
    "data",
    "planning",
    "coding",
    "qa",
    "writing",
    "brief",
    "maths",
    "ops",
]
CHECKS: list[tuple[str, re.Pattern[str]]] = [
    ("research", meetings._RESEARCH),
    ("review", meetings._REVIEW),
    ("data", meetings._DATA),
    ("planning", meetings._PLANNING),
    ("coding", meetings._CODING),
    ("qa", meetings._QA),
    ("writing", meetings._WRITING),
    ("brief", meetings._BRIEF),
    ("maths", meetings._MATHS),
    ("ops", meetings._OPS),
]


def _clean_part(part: str) -> str:
    return re.sub(r"^\s*(?:and\s+)", "", (part or "").strip(), flags=re.I).strip(" \t-")


def split_task_list(text: str) -> list[str]:
    """Break a numbered / bulleted / comma list into 2–4 individual jobs."""
    blob = (text or "").strip()
    if not blob:
        return []
    numbered = [_clean_part(p) for p in _NUMBERED_LINE.findall(blob)]
    numbered = [p for p in numbered if p]
    if len(numbered) >= 2:
        return numbered[:4]
    inline = [_clean_part(p) for p in _NUMBERED_INLINE.split(blob)]
    inline = [p for p in inline if p]
    if len(inline) >= 2:
        return inline[:4]
    lines = [_clean_part(ln) for ln in blob.splitlines() if _clean_part(ln)]
    if 2 <= len(lines) <= 4 and all(4 <= len(ln) <= 220 for ln in lines):
        return lines
    clauses = [_clean_part(p) for p in _CLAUSE.split(blob)]
    clauses = [p for p in clauses if p]
    if 2 <= len(clauses) <= 4 and all(4 <= len(p) <= 180 for p in clauses):
        return clauses
    return []


def strength_for_part(part: str) -> str:
    suggested = meetings._suggest_strength(part)
    if PAGE.search(part) and suggested not in {"research", "review", "qa"}:
        return "coding"
    return suggested


def part_prompt(part: str, index: int, total: int) -> str:
    return (
        f"This is part {index} of {total} from a split list. "
        f"Do only this part. Ignore the other parts.\n\n{part.strip()}"
    )


def apply_list_to_chain(raw_steps: list[dict[str, Any]], parts: list[str]) -> list[dict[str, Any]]:
    used: list[str] = []
    out: list[dict[str, Any]] = []
    total = min(4, len(parts))
    for i, part in enumerate(parts[:4]):
        given = raw_steps[i] if i < len(raw_steps) else {}
        strength = strength_for_part(part)
        agent_id = given.get("agent_id") or None
        if agent_id:
            used.append(str(agent_id))
        else:
            agent = pick_best_idle(strength, used)
            agent_id = (agent or {}).get("id")
            if agent_id:
                used.append(str(agent_id))
        if not agent_id:
            continue
        out.append(
            {
                "agent_id": agent_id,
                "strength": strength,
                "prompt": part_prompt(part, i + 1, total),
                "inherit": False,
                "depends_on": None,
            }
        )
    return out


def flags_in(text: str) -> list[str]:
    blob = text or ""
    found: list[str] = []
    for name, rx in CHECKS:
        if rx.search(blob) and name not in found:
            found.append(name)
    if PAGE.search(blob) and "coding" not in found:
        found.append("coding")
    return [name for name in ORDER if name in found]


def plan(text: str) -> list[dict[str, Any]]:
    blob = (text or "").strip()
    parts = split_task_list(blob)
    if len(parts) >= 2:
        return apply_list_to_chain([], parts)
    flags = flags_in(blob)
    multi = bool(CONNECTOR.search(blob)) and len(flags) >= 2
    if multi:
        steps = flags[:4]
    elif len(flags) == 1:
        steps = flags
    else:
        steps = []
    used: list[str] = []
    out: list[dict[str, Any]] = []
    if not steps:
        agent = pick_best_idle("ops", used) or _any_agent()
        if not agent:
            return []
        out.append(
            {
                "agent_id": agent["id"],
                "strength": (agent.get("strengths") or ["ops"])[0],
                "prompt": blob,
                "inherit": False,
            }
        )
        return out
    for strength in steps:
        agent = pick_best_idle(strength, used)
        if not agent:
            agent = _any_agent()
        if not agent:
            continue
        used.append(agent["id"])
        out.append(
            {
                "agent_id": agent["id"],
                "strength": strength,
                "prompt": f"{blob}\n\nYour part of this job: {strength}.",
                "inherit": len(out) > 0,
            }
        )
    return out[:4]


def pick_best_idle(strength: str, used_ids: list[str] | None = None) -> dict[str, Any] | None:
    used = set(used_ids or [])
    agents = db.list_agents()
    if not agents:
        return None
    matching = [a for a in agents if strength in (a.get("strengths") or [])]
    pool = matching or list(agents)
    idle = [a for a in pool if not db.agent_busy(a["id"])]
    prefer = [a for a in (idle or pool) if a["id"] not in used]
    pool = prefer or idle or pool
    snap = _plant()
    pool = sorted(pool, key=lambda a: _slot_score(a, snap, strength, used))
    return pool[0] if pool else None


def _any_agent() -> dict[str, Any] | None:
    agents = db.list_agents()
    return agents[0] if agents else None


def _plant() -> dict[str, Any]:
    try:
        import plant

        return plant.snapshot()
    except Exception:
        return {}


def _slot_score(agent: dict[str, Any], snap: dict[str, Any], strength: str, used: set[str]) -> tuple[int, int, int]:
    model = str(agent.get("model") or "")
    busy_slot = 0
    if model.startswith(("local:", "ollama:")) and (snap.get("local") or {}).get("busy"):
        busy_slot = 1
    if model.startswith("spark:") and (snap.get("spark1") or {}).get("busy") and (snap.get("spark2") or {}).get("busy"):
        busy_slot = 1
    match = 0 if strength in (agent.get("strengths") or []) else 1
    reused = 1 if agent["id"] in used else 0
    return (reused, busy_slot, match)


def caption_for(steps: list[dict[str, Any]]) -> str:
    names: list[str] = []
    for step in steps:
        agent = db.get_agent(str(step.get("agent_id") or ""))
        if agent and agent.get("name") and agent["name"] not in names:
            names.append(agent["name"])
    if len(names) <= 1:
        return ""
    if len(names) == 2:
        return f"Foreman split this onto {names[0]} and {names[1]}"
    return f"Foreman split this onto {', '.join(names[:-1])}, and {names[-1]}"
