"""Foundry control plane. OpenCode Zen, OpenRouter, local Ollama, and Spark."""

from __future__ import annotations

import asyncio
import json
import mimetypes
import os
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
import games as game_relay
import harness
import lists
import llm
import local
import meetings
import sandbox
import strengths as skillset
import zen

load_dotenv(Path(__file__).resolve().parent / ".env")

FOUNDRY_TOKEN = (os.getenv("FOUNDRY_TOKEN") or "").strip()

app = FastAPI(title="Foundry", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
    allow_origin_regex=r"https://.*\.ts\.net(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db.PFPS.mkdir(parents=True, exist_ok=True)
app.mount("/pfps", StaticFiles(directory=db.PFPS), name="pfps")


def _request_token(request: Request) -> str:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.query_params.get("token") or "").strip()


@app.middleware("http")
async def foundry_token(request: Request, call_next):
    if not FOUNDRY_TOKEN or request.method == "OPTIONS":
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        if _request_token(request) != FOUNDRY_TOKEN:
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
    return await call_next(request)


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def send(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        text = json.dumps(payload)
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


hub = Hub()
loop: asyncio.AbstractEventLoop | None = None


def broadcast(payload: dict[str, Any]) -> asyncio.Task | None:
    if loop is None:
        return None
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        return loop.create_task(hub.send(payload))
    asyncio.run_coroutine_threadsafe(hub.send(payload), loop)
    return None


class AgentIn(BaseModel):
    name: str
    description: str = ""
    pigment: str | None = None
    pfp: str | None = None
    strengths: list[str] = Field(default_factory=lambda: ["coding"])
    instructions: str = ""
    model: str | None = None
    look: dict[str, Any] | None = None


class AgentPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    pigment: str | None = None
    pfp: str | None = None
    strengths: list[str] | None = None
    instructions: str | None = None
    model: str | None = None
    look: dict[str, Any] | None = None


class JobIn(BaseModel):
    agent_id: str
    prompt: str


class ListPatch(BaseModel):
    project_id: str | None = None


class ProjectIn(BaseModel):
    name: str
    organization: str
    project: str
    repository: str
    branch: str = "main"
    title: str | None = None


class RepoIn(BaseModel):
    repository: str
    branch: str = "main"
    label: str = "app"


class PinIn(BaseModel):
    job_id: str
    artifact_id: str
    agent_id: str | None = None
    project_id: str | None = None


class ShiftIn(BaseModel):
    cap: int = 8


class ItemIn(BaseModel):
    text: str


class ChainStepIn(BaseModel):
    agent_id: str | None = None
    strength: str = "ops"
    prompt: str | None = None
    depends_on: int | None = None
    inherit: bool = True


class AssignIn(BaseModel):
    item_id: str | None = None
    list_id: str | None = None
    text: str | None = None
    agent_id: str | None = None
    foreman: bool = False
    chain: list[ChainStepIn] | None = None


class BrainIn(BaseModel):
    organization: str | None = None
    wiki_url: str | None = None
    wiki_md: str | None = None
    project_names: list[str] | None = None
    poll_enabled: bool | None = None


class BrainDiscoverIn(BaseModel):
    url: str | None = None
    organization: str | None = None


@app.on_event("startup")
async def startup() -> None:
    global loop
    loop = asyncio.get_running_loop()
    import plant

    plant.set_broadcast(broadcast)
    resumed = db.init_db()
    seen: set[str] = set()
    for job_id in resumed:
        job = db.get_job(job_id)
        if not job or job["id"] in seen:
            continue
        seen.add(job["id"])
        harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
    for agent in db.list_agents():
        nxt = lists.start_next(agent["id"])
        job = (nxt or {}).get("job")
        if job and job["id"] not in seen:
            seen.add(job["id"])
            harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
    try:
        import chains

        for job in chains.kick_open():
            if job["id"] not in seen:
                seen.add(job["id"])
                harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
    except Exception:
        pass
    try:
        import brain as plant_brain

        plant_brain.start_poller()
    except Exception:
        pass


@app.on_event("shutdown")
async def shutdown() -> None:
    try:
        import brain as plant_brain

        await plant_brain.stop_poller()
    except Exception:
        pass


@app.get("/api/health")
async def health(ping: int = 0) -> dict[str, Any]:
    if ping:
        return {"ok": True}
    import catalog
    import plant
    import repos

    local = await catalog.refresh_local()
    spark: set[str] = set()
    if not catalog.spark_busy():
        spark = await catalog.refresh_spark()
        await catalog.refresh_spark2()
    return {
        "ok": True,
        "zen": bool(os.getenv("OPENCODE_API_KEY")),
        "openrouter": catalog.openrouter_enabled(),
        "ollama": bool(local),
        "spark": bool(spark) or catalog.spark_reachable(),
        "routers": llm.configured(),
        "meetings": meetings.status(),
        "plant": plant.snapshot(),
        "code_read": repos.has_pat(),
    }


@app.get("/api/plant")
async def plant_snap() -> dict[str, Any]:
    import plant

    return plant.snapshot()


@app.get("/api/brain")
async def brain_snap() -> dict[str, Any]:
    return db.get_brain_public()


@app.put("/api/brain")
async def brain_put(body: BrainIn) -> dict[str, Any]:
    import brain as plant_brain

    fields: dict[str, Any] = {}
    org = (body.organization or "").strip()
    wiki_url = body.wiki_url
    if org and ("://" in org or "/" in org or org.lower().startswith("dev.azure.com")):
        parsed = plant_brain.parse_azure_link(org)
        if parsed.get("organization"):
            org = parsed["organization"]
        if parsed.get("kind") == "wiki" and wiki_url is None:
            wiki_url = body.organization
    if body.organization is not None:
        fields["organization"] = org
    if wiki_url is not None:
        fields["wiki_url"] = wiki_url.strip()
    if body.wiki_md is not None:
        fields["wiki_md"] = body.wiki_md
    if body.poll_enabled is not None:
        fields["poll_enabled"] = body.poll_enabled
    if fields:
        db.put_brain(**fields)
    if org or body.project_names is not None:
        plant_brain.apply_selection(org or db.get_brain().get("organization") or "", body.project_names)
    snap = db.get_brain_public()
    broadcast({"type": "brain.updated", "brain": snap})
    return snap


@app.post("/api/brain/discover")
async def brain_discover(body: BrainDiscoverIn) -> dict[str, Any]:
    import brain as plant_brain

    target = (body.url or body.organization or "").strip()
    if not target:
        raise HTTPException(400, "url or organization is required")
    found = await asyncio.to_thread(plant_brain.discover, target)
    snap = db.get_brain_public()
    snap["projects_found"] = found.get("projects") or []
    if found.get("sync_error"):
        snap["sync_error"] = found["sync_error"]
    if found.get("queued"):
        plant_brain.schedule_ingest()
    broadcast({"type": "brain.updated", "brain": snap})
    return snap


@app.post("/api/brain/sync")
async def brain_sync() -> dict[str, Any]:
    import brain as plant_brain

    db.put_brain(studying=1, sync_error="Cloning every project and repo…")
    snap = db.get_brain_public()
    broadcast({"type": "brain.updated", "brain": snap})
    plant_brain.schedule_ingest()
    return snap


@app.get("/api/models")
async def models() -> dict[str, Any]:
    import catalog

    try:
        return await catalog.snapshot()
    except Exception:
        return catalog.fallback_snapshot()


@app.get("/api/strengths")
async def strength_catalog() -> dict[str, Any]:
    return skillset.snapshot()


@app.get("/api/meetings")
async def meeting_list(limit: int = 16) -> dict[str, Any]:
    return meetings.list_meetings(limit)


@app.get("/api/meeting-actions")
async def meeting_actions(
    mine: bool = True,
    meeting_id: int | None = None,
    limit: int = 40,
) -> dict[str, Any]:
    return meetings.list_actions(mine=mine, meeting_id=meeting_id, limit=limit)


@app.get("/api/projects")
async def projects() -> list[dict[str, Any]]:
    return db.list_projects()


@app.post("/api/projects")
async def add_project(body: ProjectIn) -> dict[str, Any]:
    if not all(part.strip() for part in (body.name, body.organization, body.project, body.repository)):
        raise HTTPException(400, "name, organization, project, and repository are required")
    import repos

    row = db.create_project(body.model_dump())
    return repos.sync(row["id"])


@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str) -> dict[str, Any]:
    if db.lists_using_project(project_id):
        raise HTTPException(409, "a list still uses this project")
    if not db.delete_project(project_id):
        raise HTTPException(404, "project not found")
    import repos

    repos.purge(project_id)
    return {"ok": True, "id": project_id}


@app.get("/api/projects/{project_id}/memory")
async def project_memory(project_id: str, limit: int = 12) -> dict[str, Any]:
    import memory

    if not db.get_project(project_id):
        raise HTTPException(404, "project not found")
    return {"items": memory.list_for_ui(project_id, limit=limit)}


@app.post("/api/projects/{project_id}/repos")
async def add_repo(project_id: str, body: RepoIn) -> dict[str, Any]:
    if not db.get_project(project_id):
        raise HTTPException(404, "project not found")
    if not body.repository.strip():
        raise HTTPException(400, "repository is required")
    return db.add_project_repo(
        project_id,
        body.repository,
        branch=body.branch,
        label=body.label,
    )


@app.post("/api/projects/{project_id}/sync")
async def sync_project(project_id: str) -> dict[str, Any]:
    import repos

    try:
        row = repos.sync(project_id)
    except KeyError:
        raise HTTPException(404, "project not found") from None
    if not row:
        raise HTTPException(404, "project not found")
    return row


@app.patch("/api/lists/{list_id}")
async def patch_list(list_id: str, body: ListPatch) -> dict[str, Any]:
    if not db.get_list(list_id):
        raise HTTPException(404, "list not found")
    if body.project_id and not db.get_project(body.project_id):
        raise HTTPException(404, "project not found")
    updated = db.update_list(list_id, project_id=body.project_id)
    if not updated:
        raise HTTPException(404, "list not found")
    updated["project"] = db._public_project(updated.get("project_id"))
    return updated


@app.get("/api/lists")
async def list_board() -> dict[str, Any]:
    return lists.snapshot()


@app.post("/api/lists")
async def create_list(body: ListIn) -> dict[str, Any]:
    title = body.title.strip()
    if not title:
        raise HTTPException(400, "title required")
    try:
        return db.create_list({"title": title, "kind": "custom"})
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.get("/api/lists/{list_id}")
async def get_list(list_id: str) -> dict[str, Any]:
    row = lists.get_list_payload(list_id)
    if not row:
        raise HTTPException(404, "list not found")
    return row


@app.delete("/api/lists/{list_id}")
async def remove_list(list_id: str) -> dict[str, Any]:
    if not db.delete_list(list_id):
        raise HTTPException(400, "that list cannot be deleted")
    return {"ok": True, "id": list_id}


@app.post("/api/lists/{list_id}/items")
async def add_list_item(list_id: str, body: ItemIn) -> dict[str, Any]:
    try:
        return lists.add_item(list_id, body.text)
    except KeyError:
        raise HTTPException(404, "list not found") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@app.delete("/api/items/{item_id}")
async def remove_item(item_id: str) -> dict[str, Any]:
    if not db.delete_item(item_id):
        raise HTTPException(404, "item not found")
    return {"ok": True, "id": item_id}


@app.get("/api/agents/{agent_id}/tray")
async def agent_tray(agent_id: str) -> dict[str, Any]:
    if not db.get_agent(agent_id):
        raise HTTPException(404, "agent not found")
    return {"items": db.items_for_agent(agent_id)}


@app.post("/api/assign")
async def assign_work(request: Request) -> dict[str, Any]:
    ctype = (request.headers.get("content-type") or "").lower()
    uploads: list[UploadFile] = []
    if "multipart/form-data" in ctype:
        form = await request.form()
        chain_raw = form.get("chain")
        chain = None
        if chain_raw:
            try:
                parsed = json.loads(str(chain_raw))
                chain = parsed if isinstance(parsed, list) else None
            except json.JSONDecodeError:
                chain = None
        body = AssignIn(
            item_id=str(form.get("item_id") or "") or None,
            list_id=str(form.get("list_id") or "") or None,
            text=str(form.get("text") or "") or None,
            agent_id=str(form.get("agent_id") or "") or None,
            foreman=str(form.get("foreman") or "").lower() in {"1", "true", "yes"},
            chain=chain,
        )
        for item in form.getlist("files") + form.getlist("files[]"):
            if hasattr(item, "read"):
                uploads.append(item)  # type: ignore[arg-type]
    else:
        payload = await request.json()
        body = AssignIn.model_validate(payload)
    try:
        result = lists.assign(
            item_id=body.item_id,
            list_id=body.list_id,
            text=body.text,
            agent_id=body.agent_id,
            chain=[step.model_dump() if hasattr(step, "model_dump") else step for step in body.chain] if body.chain else None,
            foreman=body.foreman,
        )
    except KeyError:
        raise HTTPException(404, "item not found") from None
    except LookupError:
        raise HTTPException(400, "no agent") from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    jobs = result.get("jobs") or ([result["job"]] if result.get("job") else [])
    if uploads:
        import eyes as vision

        first = next((j for j in jobs if j), None)
        if first:
            try:
                written = await vision.save_uploads(first, uploads)
                if written:
                    harness._trace(
                        first["id"],
                        first["agent_id"],
                        "eyes.added",
                        broadcast,
                        label="Eyes",
                        detail=", ".join(written)[:180],
                    )
            except Exception as e:
                raise HTTPException(400, str(e)) from e
    seen: set[str] = set()
    for job in jobs:
        if not job or job["id"] in seen:
            continue
        seen.add(job["id"])
        broadcast({"type": "job.queued", "job": job})
        harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
    if result.get("chain"):
        broadcast({"type": "chain.updated", "chain": result["chain"]})
    if result.get("item"):
        broadcast({"type": "task.updated", "item": result["item"]})
    return result


@app.get("/api/agents")
async def agents() -> list[dict[str, Any]]:
    return db.list_agents()


@app.post("/api/agents")
async def create_agent(body: AgentIn) -> dict[str, Any]:
    clamped = skillset.clamp(body.strengths)
    return db.create_agent({**body.model_dump(), "strengths": clamped})


@app.patch("/api/agents/{agent_id}")
async def patch_agent(agent_id: str, body: AgentPatch) -> dict[str, Any]:
    data = {k: v for k, v in body.model_dump().items() if v is not None}
    if "strengths" in data:
        data["strengths"] = skillset.clamp(data["strengths"])
    agent = db.update_agent(agent_id, data)
    if not agent:
        raise HTTPException(404, "agent not found")
    broadcast({"type": "agent.updated", "agent": agent})
    return agent


@app.post("/api/agents/{agent_id}/pfp")
async def upload_pfp(agent_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    agent = db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "agent not found")
    suffix = Path(file.filename or "pfp.png").suffix or ".png"
    dest = db.PFPS / f"{agent_id}{suffix}"
    dest.write_bytes(await file.read())
    url = f"/pfps/{dest.name}"
    updated = db.update_agent(agent_id, {"pfp": url})
    assert updated
    return updated


@app.delete("/api/agents/{agent_id}")
async def remove_agent(agent_id: str) -> dict[str, Any]:
    agent = db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "agent not found")
    db.delete_agent(agent_id)
    broadcast({"type": "agent.deleted", "agentId": agent_id, "name": agent["name"]})
    return {"ok": True, "id": agent_id}


@app.get("/api/jobs")
async def jobs(agent_id: str | None = None) -> list[dict[str, Any]]:
    return db.list_jobs(agent_id)


@app.get("/api/jobs/{job_id}")
async def job(job_id: str) -> dict[str, Any]:
    row = db.get_job(job_id)
    if not row:
        raise HTTPException(404, "job not found")
    row["events"] = db.list_events(job_id)
    row["trace"] = db.job_trace(job_id)
    row["artifacts"] = db.list_artifacts(job_id)
    return row


@app.get("/api/jobs/{job_id}/trace")
async def job_trace(job_id: str) -> dict[str, Any]:
    if not db.get_job(job_id):
        raise HTTPException(404, "job not found")
    return {"job_id": job_id, "events": db.job_trace(job_id)}


@app.get("/api/stats")
async def stats() -> dict[str, Any]:
    return db.factory_stats()


@app.get("/api/jobs/{job_id}/artifacts")
async def artifacts(job_id: str) -> list[dict[str, Any]]:
    return db.list_artifacts(job_id)


@app.get("/api/artifacts/{artifact_id}/file")
async def artifact_file(artifact_id: str, download: bool = Query(False)) -> FileResponse:
    con = db.connect()
    row = con.execute("SELECT * FROM artifacts WHERE id=?", (artifact_id,)).fetchone()
    con.close()
    if not row:
        raise HTTPException(404, "artifact not found")
    path = Path(row["path"])
    if not path.exists():
        raise HTTPException(404, "file missing")
    mime = row["mime"] or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=mime,
        filename=row["name"],
        content_disposition_type="attachment" if download else "inline",
    )


SITE_MIME = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".wasm": "application/wasm",
    ".glb": "model/gltf-binary",
    ".gltf": "model/gltf+json",
}


@app.get("/api/jobs/{job_id}/site/{path:path}")
async def job_site(job_id: str, path: str, request: Request):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    rel = (path or "").strip() or "index.html"
    ws = sandbox.workspace(job["agent_id"], job_id)
    suffix_early = Path(rel).suffix.lower()
    if suffix_early in {".html", ".htm", ""}:
        try:
            local.finish_site(ws, str(job.get("prompt") or ""))
        except Exception:
            pass
    try:
        full = sandbox.resolve(ws, rel)
    except ValueError:
        raise HTTPException(404, "invalid path") from None
    empty_headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if not full.is_file():
        suffix_hint = Path(rel).suffix.lower()
        if suffix_hint in {".js", ".mjs"}:
            return Response(
                "/* missing */",
                media_type="text/javascript; charset=utf-8",
                headers=empty_headers,
            )
        if suffix_hint == ".css":
            return Response(
                "/* missing */",
                media_type="text/css; charset=utf-8",
                headers=empty_headers,
            )
        if suffix_hint in {".json", ".glb", ".gltf", ".wasm"}:
            raise HTTPException(404, "file missing")
        if suffix_hint in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
            return Response(
                local.placeholder_png(),
                media_type=SITE_MIME.get(suffix_hint, "image/png"),
                headers=empty_headers,
            )
        if suffix_hint in {".wav", ".mp3", ".ogg"}:
            return Response(b"", media_type=SITE_MIME.get(suffix_hint, "application/octet-stream"), headers=empty_headers)
        if suffix_hint == ".svg":
            return Response(local.PLACEHOLDER_SVG, media_type="image/svg+xml", headers=empty_headers)
        if suffix_hint in {".woff", ".woff2", ".ttf", ".otf", ".ico"}:
            return Response(b"", media_type=SITE_MIME.get(suffix_hint, "application/octet-stream"), headers=empty_headers)
        return Response(b"", media_type=SITE_MIME.get(suffix_hint, "application/octet-stream"), headers=empty_headers)
    suffix = full.suffix.lower()
    mime = SITE_MIME.get(suffix) or mimetypes.guess_type(str(full))[0] or "application/octet-stream"
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if suffix in {".html", ".htm"}:
        raw = full.read_text(encoding="utf-8", errors="replace")
        base = str(request.base_url).rstrip("/") + f"/api/jobs/{job_id}/site/"
        html = local.playable_page(ws, raw, base=base, job_id=job_id)
        return HTMLResponse(html, media_type="text/html; charset=utf-8", headers=headers)
    return FileResponse(
        full,
        media_type=mime,
        filename=full.name,
        content_disposition_type="inline",
        headers=headers,
    )


@app.post("/api/jobs")
async def submit_job(body: JobIn) -> dict[str, Any]:
    agent = db.get_agent(body.agent_id)
    if not agent:
        raise HTTPException(404, "agent not found")
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(400, "prompt required")
    try:
        result = lists.assign(text=prompt, agent_id=body.agent_id, list_id="inbox")
    except LookupError:
        raise HTTPException(400, "no agent") from None
    job = result.get("job")
    if job:
        broadcast({"type": "job.queued", "job": job})
        harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
    if result.get("item"):
        broadcast({"type": "task.updated", "item": result["item"]})
    return job or result["item"]


@app.post("/api/jobs/{job_id}/cancel")
async def cancel_job(job_id: str) -> dict[str, Any]:
    if not db.get_job(job_id):
        raise HTTPException(404, "job not found")
    if not harness.request_cancel(job_id, broadcast):
        raise HTTPException(409, "job is not running")
    return {"ok": True, "id": job_id}


@app.post("/api/jobs/{job_id}/eyes")
async def add_job_eyes(job_id: str, files: list[UploadFile] = File(default=[])) -> dict[str, Any]:
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    if job.get("status") not in {"queued", "thinking", "tool", "done", "blocked"}:
        raise HTTPException(409, "job cannot take files")
    import eyes as vision

    try:
        written = await vision.save_uploads(job, files)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if written:
        harness._trace(
            job_id,
            job["agent_id"],
            "eyes.added",
            broadcast,
            label="Eyes",
            detail=", ".join(written)[:180],
        )
        broadcast({"type": "job.file", "jobId": job_id, "agentId": job["agent_id"], "files": written})
    return {"ok": True, "files": written}


@app.post("/api/coach/reset")
async def coach_reset(agent_id: str | None = None) -> dict[str, Any]:
    import coach

    coach.reset(agent_id)
    return {"ok": True, "agent_id": agent_id}


@app.websocket("/api/games/{job_id}/ws")
async def game_socket(ws: WebSocket, job_id: str) -> None:
    if FOUNDRY_TOKEN:
        if game_relay.token_from_ws(ws) != FOUNDRY_TOKEN:
            await ws.close(code=1008)
            return
    job = db.get_job(job_id)
    if not job:
        await ws.close(code=1008)
        return
    if game_relay.hub.full(job_id):
        await ws.close(code=1013)
        return
    await ws.accept()
    game_relay.hub.add(job_id, ws)
    try:
        while True:
            raw = await ws.receive_text()
            if not game_relay.message_ok(raw):
                await ws.send_text('{"error":"too large"}')
                continue
            await game_relay.hub.broadcast(job_id, raw, ws)
    except WebSocketDisconnect:
        pass
    finally:
        game_relay.hub.discard(job_id, ws)


@app.get("/api/chains/{chain_id}")
async def get_chain(chain_id: str) -> dict[str, Any]:
    chain = db.get_chain(chain_id)
    if not chain:
        raise HTTPException(404, "chain not found")
    return chain


@app.get("/api/showroom")
async def showroom() -> dict[str, Any]:
    return {"items": db.showroom_cards()}


@app.post("/api/pins")
async def add_pin(body: PinIn) -> dict[str, Any]:
    job = db.get_job(body.job_id)
    art = db.get_artifact(body.artifact_id)
    if not job or not art:
        raise HTTPException(404, "job or file not found")
    return db.add_pin(
        job_id=body.job_id,
        artifact_id=body.artifact_id,
        agent_id=body.agent_id or job["agent_id"],
        project_id=body.project_id or job.get("project_id"),
        auto=False,
    )


@app.delete("/api/pins/{pin_id}")
async def remove_pin(pin_id: str) -> dict[str, Any]:
    if not db.delete_pin(pin_id):
        raise HTTPException(404, "pin not found")
    return {"ok": True, "id": pin_id}


@app.post("/api/shift/start")
async def start_shift(body: ShiftIn) -> dict[str, Any]:
    import shift as night

    try:
        row = await night.start(cap=body.cap, broadcast=broadcast)
    except night.ShiftOpen as e:
        raise HTTPException(409, str(e)) from None
    return {"shift": row}


@app.post("/api/shift/stop")
async def stop_shift() -> dict[str, Any]:
    import shift as night

    return {"shift": await night.stop(broadcast)}


@app.get("/api/shift/latest")
async def latest_shift() -> dict[str, Any]:
    import shift as night

    row = night.latest()
    if not row:
        return {"note": "", "open": False}
    return row


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    if FOUNDRY_TOKEN:
        header = ws.headers.get("authorization") or ""
        sent = header[7:].strip() if header.lower().startswith("bearer ") else ""
        if not sent:
            sent = (ws.query_params.get("token") or "").strip()
        if sent != FOUNDRY_TOKEN:
            await ws.close(code=1008)
            return
    await hub.connect(ws)
    try:
        await ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "agents": db.list_agents(),
                    "jobs": db.in_flight_jobs(),
                    "plant": __import__("plant").snapshot(),
                    "brain": db.get_brain_public(),
                }
            )
        )
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "job.submit":
                agent_id = msg.get("agentId")
                prompt = (msg.get("prompt") or "").strip()
                task_id = msg.get("taskId")
                if not agent_id or not db.get_agent(agent_id):
                    await ws.send_text(json.dumps({"type": "error", "error": "bad job"}))
                    continue
                if not prompt and not task_id:
                    await ws.send_text(json.dumps({"type": "error", "error": "bad job"}))
                    continue
                try:
                    result = lists.assign(
                        item_id=task_id,
                        text=prompt or None,
                        agent_id=agent_id,
                        list_id="inbox",
                    )
                except (KeyError, LookupError):
                    await ws.send_text(json.dumps({"type": "error", "error": "bad job"}))
                    continue
                job = result.get("job")
                if job:
                    await hub.send({"type": "job.queued", "job": job})
                    harness.track_job(
                        job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast))
                    )
                if result.get("item"):
                    await hub.send({"type": "task.updated", "item": result["item"]})
    except WebSocketDisconnect:
        hub.disconnect(ws)


PHONE_OUT = Path(__file__).resolve().parents[2] / "AI_HarnessPhone" / "out"


@app.get("/")
async def phone_home() -> FileResponse:
    index = PHONE_OUT / "index.html"
    if not index.is_file():
        raise HTTPException(404, "phone app not built")
    return FileResponse(
        index,
        media_type="text/html",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


if PHONE_OUT.is_dir():
    app.mount("/", StaticFiles(directory=PHONE_OUT, html=True), name="phone")
