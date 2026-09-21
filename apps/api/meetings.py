"""Read-only Meeting Note Taker store + action-item extraction."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import sys
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SPEAKER_LABELS = {"me", "them"}
_ACTION_HEADING = re.compile(
    r"action|next step|follow[\s-]?up|to[\s-]?do|deliverable",
    re.I,
)
_HEADING_RE = re.compile(
    r"^\s*(?:#{1,6}\s*(?P<atx>[^#].*?)\s*#*\s*$"
    r"|\*\*(?P<bold>[^*]+?)\*\*\s*:?\s*$"
    r"|(?P<plain>[A-Za-z\u0600-\u06FF][\w &/\-\u0600-\u06FF]{2,60}):\s*$)"
)
_BULLET_RE = re.compile(r"^\s*(?:[-*\u2022]|\d+[.)]|- \[[ xX]\])\s+(?P<text>.+?)\s*$")
_OWNER_WILL_RE = re.compile(
    r"^(?P<owner>Me|Them|[A-Z][\w.'\-]+(?: [A-Z][\w.'\-]+){0,3})\s+will\s+(?P<rest>\S.*)$"
)
_OWNER_COLON_RE = re.compile(
    r"^(?P<owner>(?:Me|Them|[A-Z][\w.'\-]+(?: [A-Z][\w.'\-]+)?))\s*:\s*(?P<rest>\S.*)$"
)
_CODING = re.compile(
    r"\b(code|fix|bug|script|python|repo|git|endpoint|api|mcp|widget|refactor|frontend|backend)\b",
    re.I,
)
_MATHS = re.compile(
    r"\b(calculat|equation|simulat|residual|integral|proof|numeric|algebra|stat)\b",
    re.I,
)
_DATA = re.compile(
    r"\b(dashboard|metric|csv|spreadsheet|chart|dataset|analy[sz]e|sql|table|kpi)\b",
    re.I,
)
_WRITING = re.compile(
    r"\b(draft|one-pager|email|write-up|document|blog|copy|memo|announcement|notes)\b",
    re.I,
)
_RESEARCH = re.compile(
    r"\b(research|look up|cite|find out|compare|summar)\b",
    re.I,
)
_PLANNING = re.compile(
    r"\b(plan|roadmap|agenda|break(?:ing)? down|priorit|milestone|timeline|scope)\b",
    re.I,
)
_OPS = re.compile(
    r"\b(follow[\s-]?up|process|checklist|standup|coordinate|schedule|ops|owner)\b",
    re.I,
)


def default_db_path() -> Path:
    env = os.getenv("MEETING_NOTES_DB_PATH") or os.getenv("MNT_DB")
    if env:
        return Path(env).expanduser()
    if sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA") or Path.home())
        return base / "meeting-note-taker" / "meetings.db"
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/meeting-note-taker/meetings.db"
    return Path.home() / ".local/share/meeting-note-taker/meetings.db"


def me_aliases() -> set[str]:
    names = {"me", "yousef", "yusuf", "youssef", "yousef khalifa", "yusuf khalifa"}
    user = (os.environ.get("USERNAME") or os.environ.get("USER") or "").strip()
    if user:
        names.add(user.lower())
        names.add(user.lower().replace(".", " "))
        names.add(user.lower().replace(".", ""))
    extra = os.getenv("MEETING_ME_ALIASES") or ""
    for part in extra.split(","):
        if part.strip():
            names.add(part.strip().lower())
    return names


def _clean_title(title: str) -> str:
    if not title:
        return title
    t = re.sub(r"\s*\b(and|with|&|,)\s+(me|them)\b", "", title, flags=re.IGNORECASE)
    t = re.sub(r"\b(me|them)\b\s*(and|with|&|,)\s+", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\b(me|them)\b", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s{2,}", " ", t).strip().strip(",&").strip()
    return t or title


def _clean_attendees(raw: str | None) -> list[str]:
    try:
        names = json.loads(raw) if raw else []
    except (ValueError, TypeError):
        names = []
    return [
        n for n in names
        if isinstance(n, str) and n.strip().lower() not in _SPEAKER_LABELS
    ]


def _to_local_iso(recorded_at: str | None) -> str:
    if not recorded_at:
        return ""
    try:
        dt = datetime.fromisoformat(recorded_at)
    except ValueError:
        return recorded_at
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone().isoformat()


def _connect(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(str(path))
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5.0)
    conn.row_factory = sqlite3.Row
    return conn


def status() -> dict[str, Any]:
    path = default_db_path()
    return {
        "path": str(path),
        "found": path.exists(),
    }


def list_meetings(limit: int = 16) -> dict[str, Any]:
    path = default_db_path()
    info = status()
    if not info["found"]:
        return {**info, "meetings": []}
    limit = max(1, min(int(limit), 50))
    with closing(_connect(path)) as conn:
        rows = conn.execute(
            "SELECT id, title, recorded_at, duration_seconds, attendees, summary "
            "FROM meetings ORDER BY recorded_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    meetings = []
    for row in rows:
        actions = extract_actions(row["id"], row["title"], row["recorded_at"], row["summary"] or "")
        meetings.append(
            {
                "id": row["id"],
                "title": _clean_title(row["title"]),
                "date": _to_local_iso(row["recorded_at"]),
                "duration_minutes": round((row["duration_seconds"] or 0) / 60),
                "attendees": _clean_attendees(row["attendees"]),
                "action_count": len(actions),
                "mine_count": sum(1 for a in actions if a["mine"]),
            }
        )
    return {**info, "meetings": meetings}


def list_actions(*, mine: bool = True, meeting_id: int | None = None, limit: int = 40) -> dict[str, Any]:
    path = default_db_path()
    info = status()
    if not info["found"]:
        return {**info, "actions": []}
    limit = max(1, min(int(limit), 80))
    sql = (
        "SELECT id, title, recorded_at, summary FROM meetings "
        + ("WHERE id = ? " if meeting_id is not None else "")
        + "ORDER BY recorded_at DESC LIMIT ?"
    )
    params: list[Any] = [meeting_id, 20] if meeting_id is not None else [20]
    with closing(_connect(path)) as conn:
        rows = conn.execute(sql, params).fetchall()
    out: list[dict[str, Any]] = []
    for row in rows:
        for action in extract_actions(row["id"], row["title"], row["recorded_at"], row["summary"] or ""):
            if mine and not action["mine"]:
                continue
            out.append(action)
            if len(out) >= limit:
                return {**info, "actions": out}
    return {**info, "actions": out}


def extract_actions(meeting_id: int, title: str, recorded_at: str, summary: str) -> list[dict[str, Any]]:
    sections = _parse_sections(summary)
    aliases = me_aliases()
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for heading, bullets in sections:
        if not _ACTION_HEADING.search(heading):
            continue
        for bullet in bullets:
            key = bullet.lower()
            if key in seen:
                continue
            seen.add(key)
            owner, text = _split_owner(bullet)
            mine = _is_mine(owner, text, aliases)
            items.append(
                {
                    "id": f"m{meeting_id}-{len(items)+1}",
                    "meeting_id": meeting_id,
                    "meeting_title": _clean_title(title),
                    "date": _to_local_iso(recorded_at),
                    "heading": heading,
                    "text": text,
                    "owner": owner,
                    "mine": mine,
                    "suggested": _suggest_strength(text),
                    "prompt": _job_prompt(_clean_title(title), _to_local_iso(recorded_at), owner, text),
                }
            )
    return items


def _parse_sections(summary: str) -> list[tuple[str, list[str]]]:
    sections: list[tuple[str, list[str]]] = []
    current: str | None = None
    bullets: list[str] = []
    for raw in (summary or "").splitlines():
        line = raw.rstrip()
        if not line.strip():
            continue
        heading_match = _HEADING_RE.match(line)
        bullet_match = _BULLET_RE.match(line)
        if heading_match and not bullet_match:
            if current is not None:
                sections.append((current, bullets))
            current = (
                heading_match.group("atx")
                or heading_match.group("bold")
                or heading_match.group("plain")
                or ""
            ).strip()
            bullets = []
            continue
        text = bullet_match.group("text").strip() if bullet_match else line.strip()
        if current is not None:
            bullets.append(text)
    if current is not None:
        sections.append((current, bullets))
    return sections


def _split_owner(bullet: str) -> tuple[str | None, str]:
    body = bullet.strip()
    match = _OWNER_WILL_RE.match(body) or _OWNER_COLON_RE.match(body)
    if match:
        return match.group("owner").strip(), match.group("rest").strip()
    return None, body


def _is_mine(owner: str | None, text: str, aliases: set[str]) -> bool:
    if owner:
        low = owner.lower().strip()
        for alias in aliases:
            if len(alias) <= 2:
                if low == alias:
                    return True
            elif alias == low or alias in low:
                return True
        return False
    blob = text.lower()
    return any(len(alias) > 3 and alias in blob for alias in aliases)


def _suggest_strength(text: str) -> str:
    if _MATHS.search(text):
        return "maths"
    if _DATA.search(text):
        return "data"
    if _CODING.search(text):
        return "coding"
    if _WRITING.search(text):
        return "writing"
    if _RESEARCH.search(text):
        return "research"
    if _PLANNING.search(text):
        return "planning"
    if _OPS.search(text):
        return "ops"
    return "ops"


def _job_prompt(title: str, date: str, owner: str | None, text: str) -> str:
    who = f"Owner: {owner}\n" if owner else ""
    return (
        f"Complete this action from a recorded meeting.\n"
        f"Meeting: {title}\n"
        f"When: {date}\n"
        f"{who}"
        f"Action: {text}\n\n"
        "Produce the finished deliverable in your reply."
    )
