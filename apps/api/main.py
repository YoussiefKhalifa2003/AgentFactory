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
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

import db
import harness
import lists
import llm
import local
import meetings
import sandbox
import strengths as skillset
import zen

load_dotenv()

app = FastAPI(title="Foundry", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

db.PFPS.mkdir(parents=True, exist_ok=True)
app.mount("/pfps", StaticFiles(directory=db.PFPS), name="pfps")


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


class AgentPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    pigment: str | None = None
    pfp: str | None = None
    strengths: list[str] | None = None
    instructions: str | None = None
    model: str | None = None


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


class ItemIn(BaseModel):
    text: str


class AssignIn(BaseModel):
    item_id: str | None = None
    list_id: str | None = None
    text: str | None = None
    agent_id: str | None = None


@app.on_event("startup")
async def startup() -> None:
    global loop
    loop = asyncio.get_running_loop()
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


@app.get("/api/health")
async def health() -> dict[str, Any]:
    import catalog

    local = await catalog.refresh_local()
    spark = await catalog.refresh_spark()
    return {
        "ok": True,
        "zen": bool(os.getenv("OPENCODE_API_KEY")),
        "openrouter": catalog.openrouter_enabled(),
        "ollama": bool(local),
        "spark": bool(spark) or catalog.spark_reachable(),
        "routers": llm.configured(),
        "meetings": meetings.status(),
    }


@app.get("/api/models")
async def models() -> dict[str, Any]:
    import catalog

    return await catalog.snapshot()


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
    return db.create_project(body.model_dump())


@app.delete("/api/projects/{project_id}")
async def remove_project(project_id: str) -> dict[str, Any]:
    if db.lists_using_project(project_id):
        raise HTTPException(409, "a list still uses this project")
    if not db.delete_project(project_id):
        raise HTTPException(404, "project not found")
    import shutil

    import repos

    shutil.rmtree(repos.cache_dir(project_id), ignore_errors=True)
    return {"ok": True, "id": project_id}


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
    return db.create_list({"title": title, "kind": "custom"})


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
async def assign_work(body: AssignIn) -> dict[str, Any]:
    try:
        result = lists.assign(
            item_id=body.item_id,
            list_id=body.list_id,
            text=body.text,
            agent_id=body.agent_id,
        )
    except KeyError:
        raise HTTPException(404, "item not found") from None
    except LookupError:
        raise HTTPException(400, "no agent") from None
    job = result.get("job")
    if job:
        broadcast({"type": "job.queued", "job": job})
        harness.track_job(job["id"], asyncio.create_task(harness.run_job(job["id"], broadcast)))
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
    row["artifacts"] = db.list_artifacts(job_id)
    return row


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
}


@app.get("/api/jobs/{job_id}/site/{path:path}")
async def job_site(job_id: str, path: str, request: Request):
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    rel = (path or "").strip() or "index.html"
    ws = sandbox.workspace(job["agent_id"], job_id)
    try:
        full = sandbox.resolve(ws, rel)
    except ValueError:
        raise HTTPException(404, "invalid path") from None
    if not full.is_file():
        raise HTTPException(404, "file missing")
    suffix = full.suffix.lower()
    mime = SITE_MIME.get(suffix) or mimetypes.guess_type(str(full))[0] or "application/octet-stream"
    headers = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    if suffix in {".html", ".htm"}:
        raw = full.read_text(encoding="utf-8", errors="replace")
        base = str(request.base_url).rstrip("/") + f"/api/jobs/{job_id}/site/"
        html = local.playable_page(ws, raw, base=base)
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


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await hub.connect(ws)
    try:
        await ws.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "agents": db.list_agents(),
                    "jobs": db.in_flight_jobs(),
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
