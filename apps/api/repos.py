"""Read-only Azure DevOps checkouts. The token never touches disk."""

from __future__ import annotations

import base64
import os
import shutil
import subprocess
from pathlib import Path

from dotenv import dotenv_values

import db

ENV_FILE = Path(__file__).resolve().parent / ".env"
# Read on each sync so a token added to .env is picked up without a restart.
MISSING_PAT = (
    "Add AZURE_DEVOPS_PAT to apps/api/.env (code-read scope), then press Sync."
)

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


def checkout_dir(project_id: str, repo_id: str) -> Path:
    default = db.default_repo_id(project_id)
    if repo_id == default or repo_id == f"{project_id}-default":
        return cache_dir(project_id)
    path = (db.DATA / "repos" / f"{project_id}--{repo_id}").resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def extra_checkout_dirs(project_id: str) -> list[Path]:
    parent = (db.DATA / "repos").resolve()
    if not parent.is_dir():
        return []
    prefix = f"{project_id}--"
    return [p for p in parent.iterdir() if p.is_dir() and p.name.startswith(prefix)]


def repo_root(project_id: str) -> Path | None:
    roots = roots_for(project_id)
    return roots[0][1] if roots else None


def roots_for(project_id: str) -> list[tuple[str, Path, str]]:
    """label, path, repo_id for every synced checkout."""
    found: list[tuple[str, Path, str]] = []
    for row in db.list_project_repos(project_id):
        path = checkout_dir(project_id, row["id"])
        if (path / ".git").is_dir():
            found.append((row.get("label") or "app", path, row["id"]))
    if found:
        return found
    fallback = cache_dir(project_id)
    if (fallback / ".git").is_dir():
        return [("app", fallback, project_id)]
    return []


def remote_url(project: dict, repository: str | None = None) -> str:
    org = project["organization"].strip()
    name = project["project"].strip()
    repo = (repository or project["repository"]).strip()
    return f"https://dev.azure.com/{org}/{name}/_git/{repo}"


def _pat() -> str:
    env_pat = (os.getenv("AZURE_DEVOPS_PAT") or "").strip()
    file_pat = (dotenv_values(ENV_FILE).get("AZURE_DEVOPS_PAT") or "").strip()
    return env_pat or file_pat


def has_pat() -> bool:
    return bool(_pat())


def _auth_header() -> str | None:
    pat = _pat()
    if not pat:
        return None
    token = base64.b64encode(f":{pat}".encode()).decode()
    return f"Authorization: Basic {token}"


def _redact(text: str) -> str:
    pat = _pat()
    if pat:
        text = text.replace(pat, "…")
    return text[:400]


def _looks_like_auth(message: str) -> bool:
    blob = message.lower()
    return any(
        mark in blob
        for mark in (
            "authentication failed",
            "could not read username",
            "terminal prompts disabled",
            "401",
            "403",
            "tf401019",
            "tf401027",
            "access denied",
            "not authorized",
            "fatal: could not read",
            "invalid credentials",
        )
    )


def _git(
    args: list[str],
    cwd: Path | None = None,
    header: str | None = None,
) -> subprocess.CompletedProcess[str]:
    cmd = ["git"]
    if header:
        cmd += ["-c", f"http.extraHeader={header}"]
    cmd += args
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GCM_INTERACTIVE"] = "never"
    env.pop("AZURE_DEVOPS_PAT", None)
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=120,
        env=env,
    )


def _sync_one(header: str | None, url: str, branch: str, root: Path) -> None:
    if (root / ".git").is_dir():
        fetched = _git(["fetch", "--depth", "1", "origin", branch], root, header=header)
        if fetched.returncode != 0:
            raise RuntimeError(_redact(fetched.stderr or fetched.stdout or "fetch failed"))
        checked = _git(["checkout", "-f", "FETCH_HEAD"], root, header=header)
        if checked.returncode != 0:
            raise RuntimeError(_redact(checked.stderr or checked.stdout or "checkout failed"))
        return
    parent = root.parent
    if root.exists():
        shutil.rmtree(root, ignore_errors=True)
    cloned = _git(
        ["clone", "--depth", "1", "--branch", branch, url, str(root)],
        parent,
        header=header,
    )
    if cloned.returncode != 0:
        raise RuntimeError(_redact(cloned.stderr or cloned.stdout or "clone failed"))


def sync(project_id: str) -> dict:
    project = db.get_project(project_id)
    if not project:
        raise KeyError("project not found")
    if not shutil.which("git"):
        return db.update_project(project_id, sync_error="git is not installed") or project
    header = _auth_header()
    if not header:
        return db.update_project(project_id, sync_error=MISSING_PAT) or project
    rows = db.list_project_repos(project_id)
    if not rows:
        rows = [
            {
                "id": f"{project_id}-default",
                "repository": project["repository"],
                "branch": project.get("branch") or "main",
                "label": "app",
            }
        ]
    errors: list[str] = []
    for row in rows:
        branch = (row.get("branch") or project.get("branch") or "main").strip() or "main"
        url = remote_url(project, row["repository"])
        root = checkout_dir(project_id, row["id"])
        try:
            _sync_one(header, url, branch, root)
        except (RuntimeError, subprocess.TimeoutExpired, OSError) as exc:
            message = str(exc)
            if _looks_like_auth(message):
                errors.append(
                    f"{row['repository']}: Azure DevOps refused the token. Check AZURE_DEVOPS_PAT in apps/api/.env."
                )
            else:
                errors.append(f"{row['repository']}: {message[:200]}")
    if errors:
        return db.update_project(project_id, sync_error="; ".join(errors)[:400]) or project
    return db.update_project(project_id, synced_at=db.utcnow(), sync_error=None) or project


def purge(project_id: str) -> None:
    shutil.rmtree(cache_dir(project_id), ignore_errors=True)
    for path in extra_checkout_dirs(project_id):
        shutil.rmtree(path, ignore_errors=True)


def _safe_rel(rel: str) -> str:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/") or ":" in rel:
        raise ValueError("path refused")
    return rel


def resolve(project_id: str, rel: str) -> Path:
    rel = _safe_rel(rel)
    roots = roots_for(project_id)
    if not roots:
        raise FileNotFoundError("code cache is not ready")
    parts = rel.split("/")
    for label, root, _repo_id in roots:
        if parts[0] == label:
            rest = "/".join(parts[1:])
            if not rest:
                raise ValueError("path refused")
            path = (root / rest).resolve()
            path.relative_to(root)
            return path
    last_error: Exception | None = None
    for _label, root, _repo_id in roots:
        try:
            path = (root / rel).resolve()
            path.relative_to(root)
            if path.is_file():
                return path
        except ValueError as exc:
            last_error = exc
            continue
    if last_error:
        raise ValueError("path refused") from last_error
    raise FileNotFoundError("code cache is not ready")


def _skip(path: Path, root: Path) -> bool:
    rel = path.relative_to(root)
    return any(part in SKIP_DIRS for part in rel.parts)


def search(project_id: str, query: str) -> str:
    project = db.get_project(project_id)
    roots = roots_for(project_id)
    if not roots:
        err = (project or {}).get("sync_error") or "not synced"
        return f"error: code cache is not ready. {err}"
    needle = (query or "").strip().lower()
    if not needle:
        return "error: query required"
    hits: list[str] = []
    for label, root, _repo_id in roots:
        prefix = f"{label}/" if len(roots) > 1 else ""
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
                    hits.append(f"{prefix}{rel}:{i}: {snippet}")
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
    roots = roots_for(project_id)
    if not roots:
        return ""
    lines: list[str] = []
    for label, root, _repo_id in roots:
        if len(roots) > 1:
            lines.append(f"{label}/")
        for path in sorted(root.rglob("*")):
            if not path.is_dir() or _skip(path, root):
                continue
            rel = path.relative_to(root)
            if rel == Path("."):
                continue
            if len(rel.parts) > 2:
                continue
            prefix = f"{label}/" if len(roots) > 1 else ""
            lines.append(prefix + rel.as_posix() + "/")
            blob = "\n".join(lines)
            if len(blob) > 2000:
                break
        readme = root / "README.md"
        if readme.is_file():
            excerpt = "\n".join(readme.read_text(encoding="utf-8", errors="replace").splitlines()[:40])
            lines.append("")
            lines.append(excerpt[:1500])
        if len("\n".join(lines)) > 2000:
            break
    return "\n".join(lines)[:2000]
