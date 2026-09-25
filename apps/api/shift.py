"""Explicit night shift. No cron. Cap parked jobs, then a morning note."""

from __future__ import annotations

import asyncio
from typing import Any

import db
import lists
import meetings
import plant

Broadcast = Any
_runner: asyncio.Task | None = None
_touched: set[str] = set()


class ShiftOpen(Exception):
    pass


def _broadcast(broadcast: Broadcast | None, shift: dict[str, Any]) -> None:
    if broadcast:
        broadcast({"type": "shift.updated", "shift": {**shift, "open": not shift.get("ended_at")}})


async def start(cap: int = 8, broadcast: Broadcast | None = None) -> dict[str, Any]:
    global _runner, _touched
    if db.open_shift():
        raise ShiftOpen("a shift is already open")
    cap = max(1, min(int(cap or 8), 8))
    shift = db.create_shift("manual")
    _touched = set()
    meetings.sync_meetings() if hasattr(meetings, "sync_meetings") else None
    lists.sync_meetings()
    _broadcast(broadcast, shift)
    _runner = asyncio.create_task(_run(shift["id"], cap, broadcast))
    return {**shift, "open": True, "cap": cap}


async def stop(broadcast: Broadcast | None = None) -> dict[str, Any]:
    global _runner
    shift = db.open_shift() or db.latest_shift()
    if not shift:
        return {"id": None, "note": "", "open": False}
    if _runner and not _runner.done():
        _runner.cancel()
        try:
            await _runner
        except (asyncio.CancelledError, Exception):
            pass
    _runner = None
    note = compose_note(shift)
    ended = db.update_shift(shift["id"], ended_at=db.utcnow(), note=note) or shift
    _remember_shift(note)
    _broadcast(broadcast, ended)
    return {**ended, "open": False}


def latest() -> dict[str, Any] | None:
    row = db.latest_shift()
    if not row:
        return None
    open_row = db.open_shift()
    return {**row, "open": bool(open_row and open_row["id"] == row["id"])}


def note_job(status: str, project_id: str | None = None) -> None:
    shift = db.open_shift()
    if not shift:
        return
    fields: dict[str, Any] = {}
    if status == "done":
        fields["jobs_done"] = int(shift.get("jobs_done") or 0) + 1
    elif status in {"blocked", "cancelled"}:
        fields["jobs_blocked"] = int(shift.get("jobs_blocked") or 0) + 1
    if fields:
        db.update_shift(shift["id"], **fields)
    if project_id:
        _touched.add(project_id)


def compose_note(shift: dict[str, Any] | None = None) -> str:
    row = shift or db.latest_shift() or {}
    done = int(row.get("jobs_done") or 0)
    blocked = int(row.get("jobs_blocked") or 0)
    started = int(row.get("jobs_started") or 0)
    snap = plant.snapshot()
    overflow = []
    if not (snap.get("spark2") or {}).get("ok"):
        overflow.append(f"Spark 2 {(snap.get('spark2') or {}).get('reason') or 'offline'}")
    if (snap.get("cloud") or {}).get("inFlight"):
        overflow.append("Cloud took overflow")
    pins = db.list_pins(8)
    pin_names = []
    for pin in pins:
        art = db.get_artifact(pin["artifact_id"])
        if art:
            pin_names.append(art.get("name") or "file")
    lines = [
        f"Finished {done}.",
        f"Blocked {blocked}.",
        f"Started {started}.",
    ]
    if overflow:
        lines.append("Plant overflow: " + "; ".join(overflow) + ".")
    if pin_names:
        lines.append("Pins: " + ", ".join(pin_names[:8]) + ".")
    if not done and not blocked and not pin_names:
        lines.append("The floor was quiet.")
    return " ".join(lines)


def _remember_shift(note: str) -> None:
    import memory

    for project_id in sorted(_touched):
        memory.remember_job(
            {
                "id": f"shift-{project_id}",
                "project_id": project_id,
                "prompt": "Night shift",
                "status": "done",
            },
            {"id": "shift", "name": "Night shift"},
            note,
            [],
            kind="shift",
        )


def _local_35(agent: dict[str, Any]) -> bool:
    model = str(agent.get("model") or "").lower()
    return model.startswith(("local:", "ollama:")) and "35b" in model


async def _run(shift_id: str, cap: int, broadcast: Broadcast | None) -> None:
    started = 0
    try:
        while True:
            current = db.get_shift(shift_id) if hasattr(db, "get_shift") else db.open_shift()
            if not current or current.get("ended_at"):
                return
            if started >= cap:
                await asyncio.sleep(2)
                continue
            launched: list[dict[str, Any]] = []
            try:
                import chains

                launched.extend(chains.kick_open())
            except Exception:
                pass
            for agent in db.list_agents():
                if started + len(launched) >= cap:
                    break
                if _local_35(agent) and plant.local_locked():
                    continue
                nxt = lists.start_next(agent["id"])
                job = (nxt or {}).get("job")
                if job:
                    launched.append(job)
            fresh = []
            for job in launched:
                if started >= cap:
                    break
                started += 1
                fresh.append(job)
                if job.get("project_id"):
                    _touched.add(str(job["project_id"]))
            if fresh:
                db.update_shift(shift_id, jobs_started=started)
                _start(fresh, broadcast)
                note = compose_note(db.open_shift() or current)
                db.update_shift(shift_id, note=note)
                row = db.open_shift() or current
                _broadcast(broadcast, {**row, "note": note})
            in_flight = db.in_flight_jobs()
            if not fresh and not in_flight:
                note = compose_note(db.open_shift() or current)
                db.update_shift(shift_id, note=note)
                return
            await asyncio.sleep(1.5)
    except asyncio.CancelledError:
        return


def _start(jobs: list[dict[str, Any]], broadcast: Broadcast | None) -> None:
    import harness

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    for job in jobs:
        if broadcast:
            broadcast({"type": "job.queued", "job": job})
        harness.track_job(job["id"], loop.create_task(harness.run_job(job["id"], broadcast or (lambda _p: None))))
