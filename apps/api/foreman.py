"""Rules-only Foreman. Splits a job onto desks. Does not write files."""

from __future__ import annotations

import re
from typing import Any

import db
import meetings

CONNECTOR = re.compile(r"\b(?:and|then|plus)\b|,", re.I)
PAGE = re.compile(r"\b(page|website|html|site)\b", re.I)
ORDER = ["research", "data", "planning", "coding", "writing", "maths", "ops"]
CHECKS: list[tuple[str, re.Pattern[str]]] = [
    ("research", meetings._RESEARCH),
    ("data", meetings._DATA),
    ("planning", meetings._PLANNING),
    ("coding", meetings._CODING),
    ("writing", meetings._WRITING),
    ("maths", meetings._MATHS),
    ("ops", meetings._OPS),
]


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
