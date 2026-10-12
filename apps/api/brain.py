"""Plant-wide Agent Brain: Azure org, wiki, and prefixed code search."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx

import db
import repos

log = logging.getLogger("brain")

POLL_SECONDS = 600
API_VERSION = "7.1"
_SKIP_SEGMENTS = {
    "_git",
    "_wiki",
    "_apis",
    "_settings",
    "_build",
    "_release",
    "_boards",
    "_dashboards",
    "_workitems",
    "_packaging",
    "_artifacts",
    "_testManagement",
}

_poll_task: asyncio.Task[None] | None = None
_ingest_lock = threading.Lock()
_ingest_thread: threading.Thread | None = None
STUDY_STORE_CAP = 120_000
DIGEST_STUDY_CAP = 20_000
DIGEST_WIKI_CAP = 4_000


def parse_azure_link(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    out: dict[str, Any] = {
        "organization": "",
        "project": "",
        "repository": "",
        "wiki": "",
        "wiki_path": "",
        "kind": "",
    }
    if not raw:
        return out
    if "://" not in raw and "/" in raw:
        raw = "https://" + raw
    try:
        url = urlparse(raw)
    except ValueError:
        return out
    host = (url.hostname or "").lower()
    parts = [unquote(p) for p in (url.path or "").split("/") if p]
    query = {}
    if url.query:
        for chunk in url.query.split("&"):
            if "=" in chunk:
                key, val = chunk.split("=", 1)
                query[unquote(key)] = unquote(val.replace("+", " "))
    org = ""
    rest: list[str] = []
    if host == "dev.azure.com" and parts:
        org = parts[0]
        rest = parts[1:]
    elif host.endswith(".visualstudio.com"):
        org = host[: -len(".visualstudio.com")]
        rest = parts
    elif re.fullmatch(r"[A-Za-z0-9._-]+", raw) and "/" not in raw and " " not in raw:
        org = raw
    if not org:
        return out
    out["organization"] = org
    wiki_at = next((i for i, p in enumerate(rest) if p.lower() == "_wiki"), -1)
    git_at = next((i for i, p in enumerate(rest) if p.lower() == "_git"), -1)
    if wiki_at >= 0:
        if wiki_at >= 1:
            out["project"] = rest[0]
        wiki_parts = rest[wiki_at + 1 :]
        if wiki_parts and wiki_parts[0].lower() == "wikis":
            wiki_parts = wiki_parts[1:]
        if wiki_parts:
            out["wiki"] = wiki_parts[0]
            out["wiki_path"] = "/" + "/".join(wiki_parts[1:]) if len(wiki_parts) > 1 else query.get("pagePath") or "/"
        else:
            out["wiki_path"] = query.get("pagePath") or "/"
        out["kind"] = "wiki"
        return out
    if git_at >= 0:
        if git_at >= 1:
            out["project"] = rest[0]
        if git_at + 1 < len(rest):
            out["repository"] = rest[git_at + 1]
        out["kind"] = "repo"
        return out
    project = next((p for p in rest if p and p.lower() not in _SKIP_SEGMENTS), "")
    if project:
        out["project"] = project
        out["kind"] = "project"
    else:
        out["kind"] = "org"
    if query.get("pagePath"):
        out["wiki_path"] = query["pagePath"]
        out["kind"] = "wiki"
    return out


def _branch(raw: str | None) -> str:
    text = (raw or "main").strip() or "main"
    if text.lower().startswith("refs/heads/"):
        text = text[11:]
    return text or "main"


def _headers() -> dict[str, str] | None:
    raw = repos._auth_header()
    if not raw:
        return None
    key, _, val = raw.partition(": ")
    return {key: val, "Accept": "application/json"}


def _get_json(url: str, params: dict[str, str] | None = None) -> Any:
    headers = _headers()
    if not headers:
        raise RuntimeError(repos.MISSING_PAT)
    query = dict(params or {})
    query.setdefault("api-version", API_VERSION)
    with httpx.Client(timeout=20.0, follow_redirects=True) as client:
        response = client.get(url, headers=headers, params=query)
    if response.status_code >= 400:
        raise RuntimeError(repos._redact(f"Azure {response.status_code}: {response.text[:240]}"))
    try:
        return response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError("Azure returned a non-JSON body") from exc


def discover(org_or_url: str) -> dict[str, Any]:
    parsed = parse_azure_link(org_or_url) if "://" in (org_or_url or "") or "/" in (org_or_url or "") else {
        "organization": (org_or_url or "").strip(),
        "kind": "org",
    }
    org = (parsed.get("organization") or org_or_url or "").strip()
    if not org:
        return {"organization": "", "projects": [], "sync_error": "Paste an Azure org link."}
    db.put_brain(organization=org)
    if parsed.get("kind") == "wiki" and org_or_url:
        db.put_brain(wiki_url=org_or_url.strip())
    if not repos.has_pat():
        db.put_brain(sync_error=repos.MISSING_PAT)
        return {
            "organization": org,
            "projects": [],
            "sync_error": repos.MISSING_PAT,
            "has_pat": False,
        }
    try:
        payload = _get_json(f"https://dev.azure.com/{quote(org)}/_apis/projects")
    except Exception as exc:
        err = repos._redact(str(exc))[:400]
        db.put_brain(sync_error=err)
        return {"organization": org, "projects": [], "sync_error": err}
    found: list[dict[str, Any]] = []
    for item in payload.get("value") or []:
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        repos_found: list[dict[str, Any]] = []
        try:
            repo_payload = _get_json(
                f"https://dev.azure.com/{quote(org)}/{quote(name)}/_apis/git/repositories"
            )
            for repo in repo_payload.get("value") or []:
                repo_name = str(repo.get("name") or "").strip()
                if not repo_name:
                    continue
                repos_found.append(
                    {
                        "name": repo_name,
                        "defaultBranch": _branch(repo.get("defaultBranch")),
                    }
                )
        except Exception as exc:
            log.info("brain discover repos %s: %s", name, repos._redact(str(exc)))
        found.append(
            {
                "name": name,
                "id": item.get("id"),
                "repos": repos_found,
                "included": True,
            }
        )
    db.replace_brain_projects(
        [
            {
                "name": row["name"],
                "included": True,
                "azure_id": row.get("id"),
                "repos": row.get("repos") or [],
            }
            for row in found
        ]
    )
    apply_selection(org)
    queued = bool(found)
    if queued:
        db.put_brain(studying=1, sync_error="Cloning every project and repo…")
    else:
        db.put_brain(sync_error=None)
    return {
        "organization": org,
        "projects": found,
        "sync_error": "Cloning every project and repo…" if queued else None,
        "has_pat": True,
        "queued": queued,
    }


def apply_selection(org: str, project_names: list[str] | None = None) -> dict[str, Any]:
    org = (org or db.get_brain().get("organization") or "").strip()
    if project_names is not None:
        wanted = [n.strip() for n in project_names if n and n.strip()]
        current = {r["name"]: r for r in db.list_brain_projects()}
        merged: list[dict[str, Any]] = []
        for name in wanted:
            prev = current.get(name) or {"name": name, "included": True, "repos": []}
            prev["included"] = True
            merged.append(prev)
        for name, prev in current.items():
            if name not in wanted:
                prev["included"] = False
                merged.append(prev)
        db.replace_brain_projects(merged)
    if not org:
        return db.get_brain_public()
    db.put_brain(organization=org)
    mapping: dict[str, str] = {}
    for row in db.list_brain_projects():
        name = row["name"]
        included = bool(row.get("included"))
        linked = db.find_project(org, name)
        if not included:
            pid = str(row.get("project_id") or (linked or {}).get("id") or "")
            if pid and db.lists_using_project(pid) == 0:
                try:
                    repos.purge(pid)
                except Exception:
                    log.info("brain purge skipped for %s", name)
            continue
        azure_repos = row.get("repos") or []
        first = azure_repos[0] if azure_repos else {"name": name, "defaultBranch": "main"}
        repo_name = str(first.get("name") or name)
        branch = _branch(first.get("defaultBranch") or first.get("branch"))
        if not linked:
            linked = db.create_project(
                {
                    "name": name,
                    "title": name,
                    "organization": org,
                    "project": name,
                    "repository": repo_name,
                    "branch": branch,
                }
            )
        existing_names = {(r.get("repository") or "").lower() for r in (linked.get("repos") or [])}
        for repo in azure_repos:
            repo_name = str(repo.get("name") or "").strip()
            if not repo_name:
                continue
            if repo_name.lower() in existing_names:
                continue
            db.add_project_repo(
                linked["id"],
                repo_name,
                branch=_branch(repo.get("defaultBranch") or repo.get("branch")),
                label=repo_name,
            )
            existing_names.add(repo_name.lower())
        mapping[name] = linked["id"]
    if mapping:
        db.set_brain_project_ids(mapping)
    return db.get_brain_public()


def sync_all() -> dict[str, Any]:
    brain = db.get_brain()
    org = (brain.get("organization") or "").strip()
    apply_selection(org)
    if not repos.has_pat():
        db.put_brain(sync_error=repos.MISSING_PAT)
        return db.get_brain_public()
    errors: list[str] = []
    synced = False
    for row in db.list_brain_projects(included_only=True):
        pid = str(row.get("project_id") or "")
        if not pid:
            continue
        try:
            repos.sync(pid)
            synced = True
            linked = db.get_project(pid)
            err = (linked or {}).get("sync_error")
            if err:
                errors.append(f"{row['name']}: {err}")
        except Exception as exc:
            errors.append(f"{row['name']}: {repos._redact(str(exc))[:180]}")
    refresh_wiki()
    if errors:
        db.put_brain(sync_error="; ".join(errors)[:400], synced_at=db.utcnow() if synced else brain.get("synced_at"))
    else:
        db.put_brain(sync_error=None, synced_at=db.utcnow() if synced else brain.get("synced_at"))
    return db.get_brain_public()


def _broadcast_brain() -> None:
    try:
        from main import broadcast

        broadcast({"type": "brain.updated", "brain": db.get_brain_public()})
    except Exception:
        pass


def study_estate() -> dict[str, Any]:
    """Walk every cloned file into a plant catalog. Models are not trained."""
    parts: list[str] = []
    files = 0
    repos_n = 0
    projects_n = 0
    for row in db.list_brain_projects(included_only=True):
        pid = str(row.get("project_id") or "")
        if not pid:
            continue
        walked = repos.study_walk(pid)
        if not walked.get("files") and not walked.get("text"):
            continue
        projects_n += 1
        files += int(walked.get("files") or 0)
        repos_n += int(walked.get("repos") or 0)
        body = str(walked.get("text") or "")
        if body:
            parts.append(body)
        db.remember(
            project_id=db.BRAIN_ID,
            job_id=f"brain-study-{pid}",
            agent_id="brain",
            agent_name="Agent Brain",
            task=f"Catalog {row.get('name')}",
            status="done",
            body=body[:2500],
            files=list(walked.get("paths") or [])[:40],
            kind="study",
        )
    study = "\n\n".join(parts).strip()[:STUDY_STORE_CAP]
    db.put_brain(
        study_md=study,
        study_files=files,
        study_repos=repos_n,
        study_projects=projects_n,
    )
    return db.get_brain_public()


def ingest_all() -> dict[str, Any]:
    if not _ingest_lock.acquire(blocking=False):
        return db.get_brain_public()
    try:
        db.put_brain(studying=1, sync_error="Cloning every project and repo…")
        _broadcast_brain()
        snap = sync_all()
        clone_err = str(snap.get("sync_error") or "").strip()
        if clone_err.startswith("Cloning every") or clone_err.startswith("Reading every"):
            clone_err = ""
        db.put_brain(studying=1, sync_error="Reading every file in the org…")
        _broadcast_brain()
        study_estate()
        db.put_brain(studying=0, sync_error=clone_err or None)
        _broadcast_brain()
        return db.get_brain_public()
    except Exception as exc:
        db.put_brain(studying=0, sync_error=repos._redact(str(exc))[:400])
        _broadcast_brain()
        return db.get_brain_public()
    finally:
        _ingest_lock.release()


def schedule_ingest() -> None:
    global _ingest_thread
    if _ingest_lock.locked():
        return
    alive = _ingest_thread is not None and _ingest_thread.is_alive()
    if alive:
        return
    _ingest_thread = threading.Thread(target=ingest_all, daemon=True, name="brain-ingest")
    _ingest_thread.start()


def refresh_wiki(*, overwrite: bool = False) -> None:
    brain = db.get_brain()
    url = (brain.get("wiki_url") or "").strip()
    existing = (brain.get("wiki_md") or "").strip()
    if not url:
        return
    if existing and not overwrite:
        return
    parsed = parse_azure_link(url)
    org = parsed.get("organization") or brain.get("organization") or ""
    project = parsed.get("project") or ""
    if not org or not project:
        included = db.list_brain_projects(included_only=True)
        if included:
            project = included[0]["name"]
    if not org or not project:
        return
    if not repos.has_pat():
        db.put_brain(sync_error=repos.MISSING_PAT)
        return
    try:
        wiki_id = parsed.get("wiki") or ""
        if not wiki_id:
            listed = _get_json(
                f"https://dev.azure.com/{quote(org)}/{quote(project)}/_apis/wiki/wikis"
            )
            wikis = listed.get("value") or []
            wiki_id = str((wikis[0] or {}).get("id") or (wikis[0] or {}).get("name") or "") if wikis else ""
        if not wiki_id:
            raise RuntimeError("no wiki on that project")
        path = parsed.get("wiki_path") or "/"
        page = _get_json(
            f"https://dev.azure.com/{quote(org)}/{quote(project)}/_apis/wiki/wikis/{quote(str(wiki_id))}/pages",
            {"path": path or "/", "includeContent": "true"},
        )
        content = str(page.get("content") or "").strip()
        if content:
            db.put_brain(wiki_md=content[:80_000], sync_error=None)
    except Exception as exc:
        err = repos._redact(str(exc))[:400]
        db.put_brain(sync_error=err)


def digest() -> str:
    brain = db.get_brain()
    wiki = (brain.get("wiki_md") or "").strip()[:DIGEST_WIKI_CAP]
    study = (brain.get("study_md") or "").strip()[:DIGEST_STUDY_CAP]
    parts: list[str] = []
    counts = []
    files = int(brain.get("study_files") or 0)
    repos_n = int(brain.get("study_repos") or 0)
    projects_n = int(brain.get("study_projects") or 0)
    if files or repos_n:
        counts.append(
            f"Plant catalog: {projects_n} projects, {repos_n} repos, {files} files. "
            "Search and read those paths. Do not invent files."
        )
    if wiki:
        parts.append("Wiki\n" + wiki)
    if study:
        parts.append("Estate study\n" + study)
    else:
        trees: list[str] = []
        used = 0
        for row in db.list_brain_projects(included_only=True):
            pid = str(row.get("project_id") or "")
            if not pid:
                continue
            tree = repos.tree_map(pid)
            if not tree:
                continue
            chunk = f"{row['name']}/\n{tree}"
            if used + len(chunk) > 4000:
                remain = 4000 - used
                if remain > 80:
                    trees.append(chunk[:remain])
                break
            trees.append(chunk)
            used += len(chunk)
        if trees:
            parts.append("Code maps\n" + "\n\n".join(trees))
    body = "\n\n".join(counts + parts).strip()
    return body


def poll_once() -> None:
    brain = db.get_brain()
    if not brain.get("poll_enabled", True):
        return
    if not repos.has_pat():
        return
    if not db.list_brain_projects(included_only=True):
        return
    ingest_all()


async def _poll_loop() -> None:
    while True:
        await asyncio.sleep(POLL_SECONDS)
        try:
            await asyncio.to_thread(poll_once)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("brain poll")


def start_poller() -> None:
    global _poll_task
    if db.get_brain().get("studying"):
        db.put_brain(studying=0)
    if _poll_task and not _poll_task.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _poll_task = loop.create_task(_poll_loop())


async def stop_poller() -> None:
    global _poll_task
    task = _poll_task
    _poll_task = None
    if not task:
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):
        pass
