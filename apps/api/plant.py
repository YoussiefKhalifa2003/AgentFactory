"""GPU and Spark occupancy for the power strip and Foreman."""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

import db

Broadcast = Callable[[dict[str, Any]], None]

_lock = threading.Lock()
_broadcast: Broadcast | None = None
_last_pulse = 0.0
_local: dict[str, str] | None = None
_spark: dict[str, dict[str, str]] = {}
_cloud: dict[str, str] = {}
_spark2_ok = False
_spark2_reason = "unknown"


def set_broadcast(fn: Broadcast | None) -> None:
    global _broadcast
    _broadcast = fn


def set_spark2(ok: bool, reason: str = "") -> None:
    global _spark2_ok, _spark2_reason
    _spark2_ok = bool(ok)
    _spark2_reason = "" if ok else (reason or "unreachable")


def _agent_name(agent_id: str | None) -> str | None:
    if not agent_id:
        return None
    row = db.get_agent(agent_id)
    return (row or {}).get("name") or agent_id


def hold_local(job_id: str, agent_id: str, model: str = "") -> None:
    global _local
    with _lock:
        _local = {"job_id": job_id, "agent_id": agent_id, "model": model}
    pulse()


def release_local(job_id: str = "") -> None:
    global _local
    with _lock:
        if _local and job_id and _local.get("job_id") != job_id:
            return
        _local = None
    pulse()


def hold_spark(box: str, job_id: str, agent_id: str) -> None:
    with _lock:
        _spark[box] = {"job_id": job_id, "agent_id": agent_id}
    pulse()


def release_spark(box: str) -> None:
    with _lock:
        _spark.pop(box, None)
    pulse()


def hold_cloud(job_id: str, provider: str) -> None:
    with _lock:
        _cloud[job_id] = provider
    pulse()


def release_cloud(job_id: str) -> None:
    with _lock:
        _cloud.pop(job_id, None)
    pulse()


def local_locked() -> bool:
    with _lock:
        return _local is not None


def pulse(force: bool = False) -> None:
    global _last_pulse
    now = time.monotonic()
    if not force and now - _last_pulse < 0.25:
        return
    _last_pulse = now
    if _broadcast:
        _broadcast({"type": "plant", "plant": snapshot()})


def _slot(held: dict[str, str] | None) -> dict[str, Any]:
    if not held:
        return {"locked": False, "busy": False, "agentId": None, "agentName": None, "jobId": None, "model": None}
    agent_id = held.get("agent_id")
    return {
        "locked": True,
        "busy": True,
        "agentId": agent_id,
        "agentName": _agent_name(agent_id),
        "jobId": held.get("job_id"),
        "model": held.get("model"),
    }


def snapshot() -> dict[str, Any]:
    import catalog

    spark1 = catalog._spark_v1(catalog.SPARK_BASE)
    spark2 = catalog._spark_v1(catalog.SPARK2_BASE)
    with _lock:
        local_held = dict(_local) if _local else None
        spark_held = {k: dict(v) for k, v in _spark.items()}
        cloud = dict(_cloud)
        spark2_ok = _spark2_ok
        spark2_reason = _spark2_reason
    s1 = spark_held.get(spark1)
    s2 = spark_held.get(spark2)
    return {
        "local": {**_slot(local_held), "ok": True},
        "spark1": {
            "ok": bool(catalog.spark_reachable() or catalog.spark_enabled()),
            "busy": bool(s1),
            "agentId": (s1 or {}).get("agent_id"),
            "agentName": _agent_name((s1 or {}).get("agent_id")),
            "jobId": (s1 or {}).get("job_id"),
            "reason": None,
        },
        "spark2": {
            "ok": spark2_ok,
            "busy": bool(s2),
            "agentId": (s2 or {}).get("agent_id"),
            "agentName": _agent_name((s2 or {}).get("agent_id")),
            "jobId": (s2 or {}).get("job_id"),
            "reason": None if spark2_ok else spark2_reason,
        },
        "openrouter": {
            "ok": catalog.openrouter_enabled(),
            "inFlight": sum(1 for p in cloud.values() if p == "openrouter"),
        },
        "zen": {
            "ok": bool(os.getenv("OPENCODE_API_KEY")),
            "inFlight": sum(1 for p in cloud.values() if p == "zen"),
        },
        "cloud": {
            "ok": catalog.openrouter_enabled() or bool(os.getenv("OPENCODE_API_KEY")),
            "busy": bool(cloud),
            "inFlight": len(cloud),
        },
    }
