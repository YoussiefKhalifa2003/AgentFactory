"""Per-job workspace. Timed subprocess, no network, no host mounts."""

from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

from db import WORKSPACES

SAFE_NAME = re.compile(r"^[A-Za-z0-9._/-]+$")
MAX_FILE_BYTES = 400_000
RUN_TIMEOUT = 25


def workspace(agent_id: str, job_id: str) -> Path:
    path = (WORKSPACES / agent_id / job_id).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve(ws: Path, rel: str) -> Path:
    rel = rel.replace("\\", "/").lstrip("/")
    if not SAFE_NAME.match(rel) or ".." in rel:
        raise ValueError("invalid path")
    root = ws.resolve()
    out = (root / rel).resolve()
    try:
        out.relative_to(root)
    except ValueError as e:
        raise ValueError("path escapes workspace") from e
    return out


def write_file(ws: Path, rel: str, content: str) -> str:
    import local as _local

    return write_bytes(ws, rel, _local.decode_written_text(content or "").encode("utf-8"))


def write_bytes(ws: Path, rel: str, data: bytes) -> str:
    root = ws.resolve()
    path = resolve(ws, rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("file too large")
    path.write_bytes(data)
    return str(path.relative_to(root)).replace("\\", "/")


def read_file(ws: Path, rel: str) -> str:
    path = resolve(ws, rel)
    if not path.exists():
        raise FileNotFoundError(rel)
    return path.read_text(encoding="utf-8", errors="replace")[:80_000]


def list_files(ws: Path) -> list[str]:
    root = ws.resolve()
    if not root.exists():
        return []
    return [
        str(p.relative_to(root)).replace("\\", "/")
        for p in root.rglob("*")
        if p.is_file()
    ]


def run_python(ws: Path, rel: str, extra_args: list[str] | None = None) -> dict:
    path = resolve(ws, rel)
    if not path.exists():
        raise FileNotFoundError(rel)
    env = {
        "PATH": os.environ.get("PATH", ""),
        "SYSTEMROOT": os.environ.get("SYSTEMROOT", ""),
        "PYTHONIOENCODING": "utf-8",
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    cmd = [sys.executable, "-I", str(path), *(extra_args or [])]
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(ws),
            env=env,
            capture_output=True,
            text=True,
            timeout=RUN_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": None,
            "stdout": "",
            "stderr": f"timed out after {RUN_TIMEOUT}s",
        }
    stdout = (proc.stdout or "")[-12_000:]
    stderr = (proc.stderr or "")[-8_000:]
    return {
        "ok": proc.returncode == 0,
        "exit_code": proc.returncode,
        "stdout": stdout,
        "stderr": stderr,
    }
