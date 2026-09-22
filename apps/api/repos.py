"""Read-only Azure DevOps checkouts. The token never touches disk."""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
from pathlib import Path

import db

SKIP_DIRS = {
    ".git",
    "node_modules",
    "bin",
    "obj",
    "dist",
    ".next",
    "__pycache__",
    ".venv",
}
READABLE = {
    ".py",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".cs",
    ".json",
    ".md",
    ".yml",
    ".yaml",
    ".xml",
    ".csproj",
    ".sln",
    ".html",
    ".css",
    ".sql",
    ".txt",
    ".config",
}
MAX_FILE = 200_000
READ_CAP = 16_000


def cache_dir(project_id: str) -> Path:
    path = (db.DATA / "repos" / project_id).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def repo_root(project_id: str) -> Path | None:
    root = cache_dir(project_id)
    if not (root / ".git").is_dir():
        return None
    return root


def remote_url(project: dict) -> str:
    org = project["organization"].strip()
    name = project["project"].strip()
    repo = project["repository"].strip()
    return f"https://dev.azure.com/{org}/{name}/_git/{repo}"


def _auth_header() -> str | None:
    pat = (os.getenv("AZURE_DEVOPS_PAT") or "").strip()
    if not pat:
        return None
    token = base64.b64encode(f":{pat}".encode()).decode()
    return f"Authorization: Basic {token}"


def _git(header: str, args: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    cmd = ["git", "-c", f"http.extraHeader={header}", *args]
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=120,
    )


def sync(project_id: str) -> dict:
    project = db.get_project(project_id)
    if not project:
        raise KeyError("project not found")
    header = _auth_header()
    if not header:
        return db.update_project(project_id, sync_error="AZURE_DEVOPS_PAT is missing") or project
    if not shutil.which("git"):
        return db.update_project(project_id, sync_error="git is not installed") or project
    root = cache_dir(project_id)
    branch = (project.get("branch") or "main").strip() or "main"
    url = remote_url(project)
    try:
        if (root / ".git").is_dir():
            fetched = _git(header, ["fetch", "--depth", "1", "origin", branch], root)
            if fetched.returncode != 0:
                raise RuntimeError((fetched.stderr or fetched.stdout or "fetch failed")[:400])
            checked = _git(header, ["checkout", "-f", "FETCH_HEAD"], root)
            if checked.returncode != 0:
                raise RuntimeError((checked.stderr or checked.stdout or "checkout failed")[:400])
        else:
            parent = root.parent
            if root.exists():
                shutil.rmtree(root, ignore_errors=True)
            cloned = _git(
                header,
                ["clone", "--depth", "1", "--branch", branch, url, str(root)],
                parent,
            )
            if cloned.returncode != 0:
                raise RuntimeError((cloned.stderr or cloned.stdout or "clone failed")[:400])
    except (RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
        message = str(exc)[:400]
        return db.update_project(project_id, sync_error=message) or project
    return db.update_project(project_id, synced_at=db.utcnow(), sync_error=None) or project


def resolve(project_id: str, rel: str) -> Path:
    root = repo_root(project_id)
    if root is None:
        raise FileNotFoundError("code cache is not ready")
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/") or ":" in rel:
        raise ValueError("path refused")
    path = (root / rel).resolve()
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise ValueError("path refused") from exc
    return path


def _skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return any(part in SKIP_DIRS for part in rel.parts)


def search(project_id: str, query: str) -> str:
    project = db.get_project(project_id)
    root = repo_root(project_id)
    if root is None:
        err = (project or {}).get("sync_error") or "not synced"
        return f"error: code cache is not ready. {err}"
    needle = (query or "").strip().lower()
    if not needle:
        return "error: query required"
    hits: list[str] = []
    for path in root.rglob("*"):
        if not path.is_file() or _skip(path, root):
            continue
        if path.suffix.lower() not in READABLE:
            continue
        if path.stat().st_size > MAX_FILE:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for i, line in enumerate(text.splitlines(), start=1):
            if needle in line.lower():
                rel = path.relative_to(root).as_posix()
                snippet = line.strip()[:160]
                hits.append(f"{rel}:{i}: {snippet}")
                if len(hits) >= 20:
                    return "\n".join(hits)
    return "\n".join(hits) or "no matches"


def read_file(project_id: str, rel: str) -> str:
    project = db.get_project(project_id)
    try:
        path = resolve(project_id, rel)
    except FileNotFoundError:
        err = (project or {}).get("sync_error") or "not synced"
        return f"error: code cache is not ready. {err}"
    except ValueError:
        return "error: path refused"
    if not path.is_file():
        return "error: path refused"
    if path.suffix.lower() not in READABLE:
        return "error: path refused"
    if path.stat().st_size > MAX_FILE:
        return "error: file too large"
    return path.read_text(encoding="utf-8", errors="replace")[:READ_CAP]


def tree_map(project_id: str) -> str:
    root = repo_root(project_id)
    if root is None:
        return ""
    lines: list[str] = []
    for path in sorted(root.rglob("*")):
        if not path.is_dir() or _skip(path, root):
            continue
        rel = path.relative_to(root)
        if rel == Path("."):
            continue
        if len(rel.parts) > 2:
            continue
        lines.append(rel.as_posix() + "/")
        blob = "\n".join(lines)
        if len(blob) > 2000:
            break
    readme = root / "README.md"
    if readme.is_file():
        excerpt = "\n".join(readme.read_text(encoding="utf-8", errors="replace").splitlines()[:40])
        lines.append("")
        lines.append(excerpt[:1500])
    return "\n".join(lines)[:2000]
