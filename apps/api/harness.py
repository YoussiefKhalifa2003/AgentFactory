"""Job harness: tools, sandbox, Zen, then a backup so work still docks."""

from __future__ import annotations

import asyncio
import json
import logging
import mimetypes
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable

import httpx

import db
import lists
import local
import sandbox
import zen

Broadcast = Callable[[dict[str, Any]], None]
log = logging.getLogger("harness")
_TOOL_STRENGTHS = {"coding", "maths", "data"}

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "write_file",
            "description": "Write a UTF-8 file in the job workspace.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "content": {"type": "string"},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "Read a file from the job workspace.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_python",
            "description": "Run a Python file in the workspace. No network.",
            "parameters": {
                "type": "object",
                "properties": {"path": {"type": "string"}},
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_workspace",
            "description": "List files in the job workspace.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_url",
            "description": "Fetch a public URL and return extracted text.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
]

TOOL_BLOCK = re.compile(r'<tool\s+name="([^"]+)">\s*(.*?)\s*</tool>', re.S | re.I)
INNER_TAG = re.compile(r"<(\w+)>(.*?)</\1>", re.S)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = False
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:  # type: ignore[override]
        if tag in {"script", "style", "noscript"}:
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"}:
            self._skip = False
        if tag in {"p", "div", "br", "li", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def _html_text(html: str) -> str:
    p = _TextExtractor()
    try:
        p.feed(html)
    except Exception:
        return re.sub(r"<[^>]+>", " ", html)
    return re.sub(r"\n{3,}", "\n\n", "".join(p.parts)).strip()


async def _fetch_url(url: str) -> str:
    if not url.startswith(("http://", "https://")):
        return "error: only http(s) URLs"
    if "wikipedia.org/w/api.php" in url or "action=opensearch" in url:
        return "error: Wikipedia search API is blocked. Answer the question directly."
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(
                url,
                headers={
                    "User-Agent": "FoundryPersonal/0.1 (local research; http://127.0.0.1:3000)",
                    "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
                },
            )
    except httpx.HTTPError as e:
        return f"error: {e}"
    if r.status_code in {401, 403, 429}:
        return f"error: {url} returned {r.status_code} (blocked). Answer without this source."
    ctype = r.headers.get("content-type", "")
    text = r.text[:80_000]
    if "html" in ctype:
        text = _html_text(text)[:12_000]
    else:
        text = text[:12_000]
    if "robot policy" in text.lower() or "bot-traffic@" in text.lower():
        return f"error: {url} blocked crawlers. Answer without this source."
    return f"status={r.status_code}\nfinal_url={r.url}\n\n{text}"


TEXT_PROTOCOL = """
Write the finished answer only.
Do not show thinking, plans, or tool JSON.
Tools are optional. Prefer answering in the reply if a file is not required.
A website or game needs index.html plus styles.css and script.js, all complete. Write those files. Do not JSON-escape them. Do not put a recap inside the files.
Games must be playable when the user clicks View. Finish script.js. Wire every Start/Restart button by id. Hide menus with the same CSS class you use to show them. Prefer a complete 2D canvas game over a huge 3D engine that gets cut off. Do not rely on pointer lock. If a file is truncated, write it again in full.
Use fetch_url only for a normal page the user asked you to open.
"""


def _system_prompt(agent: dict[str, Any]) -> str:
    strengths = agent.get("strengths") or []
    packs = "\n\n".join(db.skill_text(s) for s in strengths if db.skill_text(s))
    return f"""You are {agent['name']}. You complete jobs.

{agent.get('instructions') or ''}
{agent.get('description') or ''}
Strengths: {', '.join(strengths) or 'general'}

The user message is the job. Produce the finished deliverable in the reply. Then stop.

{TEXT_PROTOCOL}

{packs}
"""


def _is_junk_output(text: str) -> bool:
    blob = (text or "").lower()
    return any(
        marker in blob
        for marker in (
            "please respect our robot policy",
            "bot-traffic@wikimedia",
            "action=opensearch",
            "wikipedia.org/w/api.php",
            "robot policy https://w.wiki",
            "can't find closing",
            "looks like object, but",
            "couldn't complete this job.",
            "couldn't finish. try again",
            "couldn't finish that job",
        )
    )


def _parse_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        pass
    for extra in ("}", "}}", '"}', '"}}'):
        try:
            data = json.loads(text + extra)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            continue
    path = re.search(r'"path"\s*:\s*"([^"\\]+)"', text)
    content_at = re.search(r'"content"\s*:\s*"', text)
    if path and content_at:
        chunk = text[content_at.end() :]
        if chunk.endswith('"'):
            chunk = chunk[:-1]
        try:
            chunk = bytes(chunk, "utf-8").decode("unicode_escape")
        except Exception:
            pass
        return {"path": path.group(1), "content": chunk}
    return {}


def _done_text(body: str, ws: Path) -> str:
    body = (body or "").strip()
    if _is_junk_output(body):
        body = ""
    files = [f for f in sandbox.list_files(ws) if not _is_junk_output(sandbox.read_file(ws, f))]
    if body and re.match(r"^done\b", body, re.I):
        text = body
    elif body:
        text = body
    elif files:
        recap = _workspace_recap(ws)
        text = recap or f"Wrote {', '.join(files)}."
    else:
        text = ""
    return text


async def _call_tool(ws: Path, name: str, args: dict[str, Any]) -> str:
    try:
        if name == "write_file":
            rel = sandbox.write_file(ws, args["path"], args.get("content", ""))
            return json.dumps({"ok": True, "path": rel})
        if name == "read_file":
            return sandbox.read_file(ws, args["path"])
        if name == "run_python":
            return json.dumps(sandbox.run_python(ws, args["path"]))
        if name == "list_workspace":
            return json.dumps({"files": sandbox.list_files(ws)})
        if name == "fetch_url":
            return await _fetch_url(str(args.get("url") or ""))
        return json.dumps({"error": f"unknown tool {name}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def _activity_for_tool(name: str) -> tuple[str, str]:
    return {
        "write_file": ("write_file", "Writing a file"),
        "read_file": ("write_file", "Reading a file"),
        "run_python": ("tool:sandbox", "Running Python at the desk"),
        "list_workspace": ("tool:sandbox", "Checking the workspace"),
        "fetch_url": ("tool:web", "Fetching a source"),
    }.get(name, ("thinking", name))


def _parse_xml_tools(text: str) -> list[tuple[str, dict[str, str]]]:
    found: list[tuple[str, dict[str, str]]] = []
    for name, inner in TOOL_BLOCK.findall(text or ""):
        args = {k: v.strip() for k, v in INNER_TAG.findall(inner)}
        found.append((name, args))
    return found


def _collect_artifacts(job: dict[str, Any], agent: dict[str, Any], ws: Path, broadcast: Broadcast) -> None:
    for path in sandbox.list_files(ws):
        full = ws / path
        suffix = full.suffix.lower()
        kind = "file"
        mime = mimetypes.guess_type(str(full))[0]
        if suffix in {".png", ".jpg", ".jpeg", ".svg", ".webp"}:
            kind = "plot"
        elif suffix in {".html", ".htm"}:
            kind = "site"
        elif suffix == ".css":
            kind = "file"
            mime = "text/css"
        elif suffix == ".js":
            kind = "file"
            mime = "text/javascript"
        elif suffix in {".drawio", ".mmd"}:
            kind = "diagram"
            mime = "application/xml" if suffix == ".drawio" else "text/plain"
        elif suffix in {".csv", ".tsv"}:
            kind = "sheet"
            mime = "text/csv"
        elif suffix == ".pdf":
            kind = "pack"
            mime = "application/pdf"
        elif suffix in {".md", ".txt"}:
            kind = "report"
        art = db.add_artifact(job["id"], agent["id"], path, kind, str(full), mime)
        broadcast({"type": "job.artifact", "jobId": job["id"], "artifact": art})


def _read_quiet(ws: Path, rel: str) -> str:
    try:
        return sandbox.read_file(ws, rel)
    except FileNotFoundError:
        return ""


def _fence_replaces(rel: str, existing: str, body: str) -> bool:
    """A later complete fence may replace a truncated first write."""
    if not (existing or "").strip():
        return True
    if rel.endswith(".js"):
        return (not local.js_looks_complete(existing)) and local.js_looks_complete(body)
    if rel.endswith(".css"):
        return (not local.css_looks_complete(existing)) and local.css_looks_complete(body)
    if rel.endswith((".html", ".htm", ".py", ".md")):
        return (not local._code_balanced(existing)) and len(body) > len(existing)
    return False


def _verify(agent: dict[str, Any], ws: Path, prompt: str, output: str) -> tuple[bool, str]:
    strengths = set(agent.get("strengths") or [])
    files = sandbox.list_files(ws)
    gap = local.site_gap(ws)
    if gap:
        return False, gap

    if "coding" in strengths:
        for candidate in ("test_main.py", "main.py"):
            if candidate in files:
                result = sandbox.run_python(ws, candidate)
                if result["ok"]:
                    return True, f"{candidate} exited 0"
                note = (result.get("stderr") or result.get("stdout") or "run failed")[:400]
                return False, f"{candidate} ran with errors: {note}"
        return (True, "reply") if output else (False, "empty")

    if "maths" in strengths:
        for candidate in ("check.py", "solution.py"):
            if candidate in files:
                result = sandbox.run_python(ws, candidate)
                out = (result.get("stdout") or "") + (result.get("stderr") or "")
                if result["ok"]:
                    return True, f"{candidate} verified"
                return False, (out or "maths check reported errors")[:400]
        return (True, "reply") if output else (False, "empty")

    if "research" in strengths:
        report = next((f for f in files if f.endswith(".md")), None)
        if not report:
            return False, "Research needs a notes file with a source."
        text = sandbox.read_file(ws, report)
        if re.search(r"https?://", text):
            return True, "cited URL present"
        if len(text.strip()) > 80 and re.search(r"https?://", prompt or ""):
            return True, "notes"
        return False, "Research notes have no source."

    return (True, "ok") if output else (False, "empty")


def _stream_text(
    broadcast: Broadcast, job_id: str, agent_id: str, content: str, *, whole: bool = False
) -> None:
    if not content:
        return
    broadcast(
        {
            "type": "job.token",
            "jobId": job_id,
            "agentId": agent_id,
            "delta": content if content.endswith("\n") or whole else content + " ",
        }
    )


class _TokenPump:
    """Send tokens out the websocket one bite at a time so the desk can paint."""

    def __init__(self, broadcast: Broadcast, job_id: str, agent_id: str) -> None:
        self.broadcast = broadcast
        self.job_id = job_id
        self.agent_id = agent_id
        self.q: asyncio.Queue[tuple[str, str] | None] = asyncio.Queue()
        self.task = asyncio.create_task(self._run())
        self.streamed = False
        self.text = ""
        self._since_save = 0

    def push(self, delta: str, channel: str = "text") -> None:
        if not delta:
            return
        self.streamed = True
        if channel == "text":
            self.text += delta
            self._since_save += len(delta)
            if self._since_save >= 480:
                self._since_save = 0
                db.update_job(self.job_id, output=self.text)
        self.q.put_nowait((channel, delta))

    async def close(self) -> None:
        await self.q.put(None)
        try:
            await self.task
        except asyncio.CancelledError:
            pass

    async def _run(self) -> None:
        while True:
            item = await self.q.get()
            if item is None:
                return
            channel, delta = item
            if len(delta) > 180:
                pieces = [delta]
            elif len(delta) <= 64:
                pieces = [delta]
            else:
                pieces = [delta[i : i + 28] for i in range(0, len(delta), 28)]
            for piece in pieces:
                fut = self.broadcast(
                    {
                        "type": "job.token",
                        "jobId": self.job_id,
                        "agentId": self.agent_id,
                        "delta": piece,
                        "channel": channel,
                    }
                )
                if fut is not None:
                    try:
                        await fut
                    except Exception:
                        pass
                if len(pieces) > 1:
                    await asyncio.sleep(0.01)
                else:
                    await asyncio.sleep(0)


def _workspace_recap(ws: Path) -> str:
    files = sandbox.list_files(ws)
    if not files:
        return ""
    for name in files:
        if not name.endswith((".py", ".md", ".txt")):
            continue
        body = sandbox.read_file(ws, name)
        if _is_junk_output(body):
            continue
        return f"{name}\n{body[:8000]}"
    return ""


async def _run_named_tool(
    ws: Path,
    name: str,
    args: dict[str, Any],
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> str:
    activity, caption = _activity_for_tool(name)
    db.update_job(job["id"], status="tool", activity=activity, caption=caption)
    event_args: dict[str, Any] = dict(args or {})
    if name == "write_file":
        body = str(event_args.get("content") or "")
        event_args = {"path": event_args.get("path") or "file", "bytes": len(body.encode("utf-8"))}
    db.add_event(job["id"], "tool", {"name": name, "args": event_args})
    broadcast(
        {
            "type": "job.activity",
            "jobId": job["id"],
            "agentId": agent["id"],
            "activity": activity,
            "caption": f"{agent['name']}: {caption}",
            "tool": name,
        }
    )
    result = await _call_tool(ws, name, args or {})
    if name == "write_file":
        path = str(args.get("path") or "file")
        _stream_text(
            broadcast,
            job["id"],
            agent["id"],
            f"Wrote {path}.\n",
            whole=True,
        )
    elif name == "run_python":
        try:
            payload = json.loads(result)
        except json.JSONDecodeError:
            payload = {"stdout": result}
        out = str(payload.get("stdout") or "") + str(payload.get("stderr") or "")
        _stream_text(
            broadcast,
            job["id"],
            agent["id"],
            f"\n$ python {args.get('path') or 'main.py'}  exit={payload.get('exit_code', '?')}\n{out[:1500]}\n",
            whole=True,
        )
    return result


async def _save_diagrams(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    import diagrams as dia

    transcripts: list[str] = []
    for rel, body in local.extract_fences(content):
        if rel.endswith(".mmd"):
            await _run_named_tool(
                ws, "write_file", {"path": rel, "content": body}, job, agent, broadcast
            )
            transcripts.append(rel)
            xml = dia.mermaid_to_drawio(body)
            await _run_named_tool(
                ws, "write_file", {"path": "diagram.drawio", "content": xml}, job, agent, broadcast
            )
            transcripts.append("diagram.drawio")
        elif rel.endswith(".drawio"):
            await _run_named_tool(
                ws, "write_file", {"path": rel, "content": body}, job, agent, broadcast
            )
            transcripts.append(rel)
    if transcripts:
        leftover = local.FENCE.sub("", leftover).strip()
        leftover = leftover or "Diagram is on this desk. Use View."
    mermaid = dia.maybe_mermaid_source(leftover)
    files = sandbox.list_files(ws)
    has_diagram = any(f.endswith((".mmd", ".drawio")) for f in files)
    if mermaid and not has_diagram:
        await _run_named_tool(
            ws, "write_file", {"path": "diagram.mmd", "content": mermaid}, job, agent, broadcast
        )
        transcripts.append("diagram.mmd")
        await _run_named_tool(
            ws,
            "write_file",
            {"path": "diagram.drawio", "content": dia.mermaid_to_drawio(mermaid)},
            job,
            agent,
            broadcast,
        )
        transcripts.append("diagram.drawio")
        leftover = leftover.replace(mermaid, "").strip() or "Diagram is on this desk. Use View."
    elif mermaid and has_diagram:
        leftover = leftover.replace(mermaid, "").strip() or leftover
    return transcripts, leftover


async def _save_sheet(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    import packs

    transcripts: list[str] = []
    for rel, body in local.extract_fences(content):
        if rel.endswith(".csv"):
            await _run_named_tool(
                ws, "write_file", {"path": "sheet.csv", "content": body}, job, agent, broadcast
            )
            leftover = local.FENCE.sub("", leftover).strip() or "Sheet is on this desk. Use View."
            return ["sheet.csv"], leftover
    csv_src = packs.maybe_csv_source(leftover)
    has_sheet = any(f.endswith(".csv") for f in sandbox.list_files(ws))
    if csv_src and not has_sheet:
        await _run_named_tool(
            ws, "write_file", {"path": "sheet.csv", "content": csv_src}, job, agent, broadcast
        )
        leftover = leftover.replace(csv_src, "").strip() or "Sheet is on this desk. Use View."
        transcripts.append("sheet.csv")
    return transcripts, leftover


async def _save_pdf(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    import packs

    md = None
    for rel, body in local.extract_fences(content):
        if rel.endswith(".md") and packs.maybe_pack_markdown(body):
            md = body
            leftover = local.FENCE.sub("", leftover).strip()
            break
    if not md:
        md = packs.maybe_pack_markdown(leftover)
        if md:
            leftover = leftover.replace(md, "").strip()
    files = sandbox.list_files(ws)
    if not md and "pack.md" in files:
        md = sandbox.read_file(ws, "pack.md")
    if not md:
        return [], leftover
    if "pack.md" not in files:
        await _run_named_tool(
            ws, "write_file", {"path": "pack.md", "content": md}, job, agent, broadcast
        )
    if "pack.pdf" not in sandbox.list_files(ws):
        title = next(
            (ln.lstrip("# ").strip() for ln in md.splitlines() if ln.startswith("# ")),
            "Pack",
        )
        try:
            sandbox.write_bytes(ws, "pack.pdf", packs.markdown_to_pdf(md, title=title))
        except Exception:
            leftover = leftover or "Wrote pack.md. Couldn't make the PDF."
            return ["pack.md"], leftover
    leftover = leftover or "PDF is on this desk. Use View."
    return ["pack.pdf"], leftover


async def _save_desk_files(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> str:
    if _has_skill(agent, "drawio"):
        leftover = (await _save_diagrams(content, leftover, ws, job, agent, broadcast))[1]
    if _has_skill(agent, "spreadsheet"):
        leftover = (await _save_sheet(content, leftover, ws, job, agent, broadcast))[1]
    if _has_skill(agent, "pdf"):
        leftover = (await _save_pdf(content, leftover, ws, job, agent, broadcast))[1]
    return leftover


async def _apply_text_actions(
    content: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    """Execute XML tools and obvious code fences. Returns (tool transcripts, leftover text)."""
    transcripts: list[str] = []
    xml = _parse_xml_tools(content)
    leftover = TOOL_BLOCK.sub("", content).strip()
    if xml:
        for name, args in xml:
            transcripts.append(await _run_named_tool(ws, name, args, job, agent, broadcast))

    leftover = await _save_desk_files(content, leftover, ws, job, agent, broadcast)

    strengths = agent.get("strengths") or []
    if "coding" in strengths or "maths" in strengths:
        present = set(sandbox.list_files(ws))
        for rel, body in local.extract_fences(content):
            if not rel.endswith((".py", ".md", ".html", ".css", ".js")):
                continue
            if rel in present and not _fence_replaces(rel, _read_quiet(ws, rel), body):
                continue
            await _run_named_tool(
                ws, "write_file", {"path": rel, "content": body}, job, agent, broadcast
            )
            transcripts.append(rel)
            present.add(rel)
            if rel.endswith(".py"):
                transcripts.append(
                    await _run_named_tool(ws, "run_python", {"path": rel}, job, agent, broadcast)
                )
        leftover = local.FENCE.sub("", leftover).strip()
        html = local.maybe_html_source(leftover)
        has_html = any(f.endswith(".html") for f in sandbox.list_files(ws))
        if html and "coding" in strengths and not has_html:
            await _run_named_tool(
                ws, "write_file", {"path": "index.html", "content": html}, job, agent, broadcast
            )
            transcripts.append("index.html")
            has_html = True
        if html and has_html:
            leftover = leftover.replace(html, "").strip() or "Built a page. Use View on this desk."
        local.materialize_site(ws, content)
    py = local.maybe_python_source(leftover)
    if py and ("coding" in strengths or "maths" in strengths):
        await _run_named_tool(
            ws, "write_file", {"path": "main.py", "content": py}, job, agent, broadcast
        )
        transcripts.append("main.py")
        leftover = ""
    return transcripts, leftover


async def _complete_with_failover(
    messages: list[dict[str, Any]],
    models: list[str],
    broadcast: Broadcast,
    job_id: str,
    agent_id: str,
    on_token: Callable[[str], None] | None = None,
    on_think: Callable[[str], None] | None = None,
    with_tools: bool = True,
) -> tuple[dict[str, Any], str]:
    import catalog

    def caption(text: str) -> None:
        db.update_job(job_id, activity="thinking", caption=text)
        broadcast(
            {
                "type": "job.activity",
                "jobId": job_id,
                "agentId": agent_id,
                "activity": "thinking",
                "caption": text,
            }
        )

    return await catalog.complete_with_failover(
        models[0] if models else "",
        messages,
        TOOLS if with_tools else None,
        on_caption=caption,
        on_token=on_token,
        on_think=on_think,
    )


def _message_from_choice(choice: dict[str, Any]) -> dict[str, Any]:
    return choice.get("message") or {}


def _touch_task(job_id: str, status: str, broadcast: Broadcast) -> None:
    item = db.mark_item_for_job(job_id, status)
    if item:
        broadcast({"type": "task.updated", "item": item})


_running: dict[str, asyncio.Task] = {}


def track_job(job_id: str, task: asyncio.Task) -> None:
    _running[job_id] = task


def request_cancel(job_id: str, broadcast: Broadcast | None = None) -> bool:
    job = db.get_job(job_id)
    if not job or job.get("status") not in {"queued", "thinking", "tool"}:
        return False
    task = _running.get(job_id)
    if task and not task.done():
        task.cancel()
        return True
    _settle_cancel(job_id, job, broadcast)
    return True


def _settle_cancel(job_id: str, job: dict[str, Any], broadcast: Broadcast | None = None) -> None:
    db.update_job(
        job_id,
        status="cancelled",
        activity="cancelled",
        caption="Stopped",
        error="Stopped from the desk",
    )
    if job.get("task_id"):
        db.update_item(str(job["task_id"]), status="open", job_id=None)
    if broadcast:
        broadcast(
            {
                "type": "job.cancelled",
                "jobId": job_id,
                "agentId": job.get("agent_id"),
                "caption": "Stopped",
                "error": "Stopped from the desk",
            }
        )
        _kick_next(str(job.get("agent_id") or ""), broadcast)


def _kick_next(agent_id: str, broadcast: Broadcast) -> None:
    nxt = lists.start_next(agent_id)
    if not nxt or not nxt.get("job"):
        return
    broadcast({"type": "job.queued", "job": nxt["job"]})
    if nxt.get("item"):
        broadcast({"type": "task.updated", "item": nxt["item"]})
    import asyncio

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    task = loop.create_task(run_job(nxt["job"]["id"], broadcast))
    track_job(nxt["job"]["id"], task)


def _has_skill(agent: dict[str, Any], name: str) -> bool:
    return name in (agent.get("strengths") or [])


def _uses_drawio(agent: dict[str, Any]) -> bool:
    return _has_skill(agent, "drawio")


def _use_tools(agent: dict[str, Any], prompt: str) -> bool:
    strengths = set(agent.get("strengths") or [])
    if strengths & _TOOL_STRENGTHS:
        return True
    if "research" in strengths and re.search(r"https?://", prompt or ""):
        return True
    return False


def _is_tool_slop(text: str) -> bool:
    blob = (text or "").strip()
    if not blob:
        return False
    if _is_junk_output(blob):
        return True
    low = blob.lower()
    if low.startswith(("<tool", "<tool_call")):
        return True
    if blob.startswith("{") and any(token in low for token in ("write_file", "tool_calls", '"name":')):
        return True
    return False


def _assistant_tool_message(content: str, tool_calls: list[dict[str, Any]]) -> dict[str, Any]:
    cleaned: list[dict[str, Any]] = []
    for i, call in enumerate(tool_calls):
        fn = call.get("function") or {}
        args = _parse_tool_args(fn.get("arguments") or "{}")
        cleaned.append(
            {
                "id": call.get("id") or f"call_{i}",
                "type": "function",
                "function": {
                    "name": fn.get("name") or "",
                    "arguments": json.dumps(args, ensure_ascii=False),
                },
            }
        )
    return {"role": "assistant", "content": content or "", "tool_calls": cleaned}


def _text_from_slop(text: str) -> str:
    """Pull a plan or answer out of a tool-call blob local models sometimes emit."""
    blob = (text or "").strip()
    if not blob:
        return ""
    data: Any = None
    try:
        data = json.loads(blob)
    except json.JSONDecodeError:
        data = None
    if isinstance(data, dict):
        for key in ("content", "plan", "answer", "text"):
            val = data.get(key)
            if isinstance(val, str) and len(val.strip()) > 24:
                return val.strip()
        args = data.get("arguments")
        fn = data.get("function") if isinstance(data.get("function"), dict) else {}
        if args is None and fn:
            args = fn.get("arguments")
        if isinstance(args, str):
            pulled = _text_from_slop(args)
            if pulled:
                return pulled
        if isinstance(args, dict):
            inner = args.get("content")
            if isinstance(inner, str) and inner.strip():
                return inner.strip()
    match = re.search(r'"content"\s*:\s*"((?:\\.|[^"\\])*)"', blob)
    if match:
        try:
            loaded = json.loads(f'"{match.group(1)}"')
        except json.JSONDecodeError:
            loaded = match.group(1)
        if isinstance(loaded, str) and loaded.strip():
            return loaded.strip()
    lines = [ln for ln in blob.splitlines() if re.match(r"\s*\d+[\.)]\s+\S", ln)]
    if len(lines) >= 2:
        return "\n".join(lines)
    return ""


def _block_job(
    job_id: str,
    agent: dict[str, Any],
    broadcast: Broadcast,
    note: str,
    output: str | None = None,
) -> None:
    job = db.get_job(job_id) or {}
    kept = output if output is not None else str(job.get("output") or "")
    if kept.strip() == (note or "").strip():
        kept = ""
    short = (note or "Couldn't complete").split("\n", 1)[0][:180]
    db.update_job(
        job_id,
        status="blocked",
        activity="blocked",
        caption=short,
        error=note,
        output=kept,
    )
    broadcast(
        {
            "type": "job.blocked",
            "jobId": job_id,
            "agentId": agent["id"],
            "error": note,
            "output": kept,
            "activity": "blocked",
            "caption": short,
        }
    )
    _touch_task(job_id, "blocked", broadcast)
    _kick_next(agent["id"], broadcast)


async def _salvage_answer(
    job_id: str,
    agent: dict[str, Any],
    ws: Path,
    broadcast: Broadcast,
    prompt: str,
    used_model: str,
    on_token: Callable[[str], None] | None,
) -> tuple[str, str]:
    recap = _workspace_recap(ws)
    if recap:
        return recap, used_model
    import catalog as _catalog

    try:
        data, used_model = await _complete_with_failover(
            [
                {"role": "system", "content": _system_prompt(agent)},
                {
                    "role": "user",
                    "content": f"{prompt}\n\nWrite the finished answer now in complete sentences. No thinking. No tools.",
                },
            ],
            [used_model or agent.get("model") or ""],
            broadcast,
            job_id,
            agent["id"],
            on_token=on_token,
            with_tools=False,
        )
        text = _catalog.strip_thinking(
            ((_message_from_choice((data.get("choices") or [{}])[0]).get("content")) or "")
        )
        if _is_junk_output(text):
            text = ""
        elif _is_tool_slop(text):
            text = _text_from_slop(text)
        return text, used_model
    except zen.ZenError:
        return "", used_model


async def _finish(
    job_id: str,
    agent: dict[str, Any],
    ws: Path,
    broadcast: Broadcast,
    output: str,
    used_model: str,
    prompt: str,
) -> None:
    job = db.get_job(job_id)
    if not job:
        return
    local.materialize_site(ws, output)
    local.heal_site(ws)
    ok, note = _verify(agent, ws, prompt, output)
    if not ok:
        _block_job(job_id, agent, broadcast, note, output=output)
        return
    _collect_artifacts(job, agent, ws, broadcast)
    db.update_job(
        job_id,
        status="done",
        activity="done",
        caption="Done",
        output=output,
        error=None,
        model=used_model,
    )
    broadcast(
        {
            "type": "job.done",
            "jobId": job_id,
            "agentId": agent["id"],
            "activity": "done",
            "caption": "Done",
            "output": output,
            "model": used_model,
            "verify": note,
        }
    )
    _touch_task(job_id, "done", broadcast)
    _kick_next(agent["id"], broadcast)


async def run_job(job_id: str, broadcast: Broadcast) -> None:
    job = db.get_job(job_id)
    if not job:
        return
    agent = db.get_agent(job["agent_id"])
    if not agent:
        db.update_job(job_id, status="blocked", activity="blocked", error="missing agent")
        broadcast({"type": "job.blocked", "jobId": job_id, "error": "missing agent"})
        _touch_task(job_id, "blocked", broadcast)
        return

    ws = sandbox.workspace(agent["id"], job_id)
    prompt = job["prompt"]
    used_model = "local"

    db.update_job(job_id, status="thinking", activity="thinking", caption="Working")
    broadcast(
        {
            "type": "job.started",
            "jobId": job_id,
            "agentId": agent["id"],
            "activity": "thinking",
            "caption": "Working",
        }
    )
    _touch_task(job_id, "working", broadcast)

    try:
        if local.is_smalltalk(prompt):
            text = await local.greet(agent, prompt)
            _stream_text(broadcast, job_id, agent["id"], text)
            await _finish(job_id, agent, ws, broadcast, text, "local", prompt)
            return

        coded = await local.from_user_code(prompt, ws)
        if coded:
            done = _done_text(coded, ws)
            _stream_text(broadcast, job_id, agent["id"], done)
            await _finish(job_id, agent, ws, broadcast, done, "local", prompt)
            return

        if "maths" in (agent.get("strengths") or []):
            mathed = local.maths_script(prompt, ws)
            if mathed:
                done = _done_text(mathed, ws)
                _stream_text(broadcast, job_id, agent["id"], done)
                await _finish(job_id, agent, ws, broadcast, done, "local", prompt)
                return

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _system_prompt(agent)},
            {"role": "user", "content": prompt},
        ]
        used_model = agent.get("model") or ""
        output_parts: list[str] = []
        pump = _TokenPump(broadcast, job_id, agent["id"])

        def on_token(delta: str) -> None:
            pump.push(delta, "text")

        def on_think(delta: str) -> None:
            pump.push(delta, "think")

        try:
            allow_tools = _use_tools(agent, prompt)
            for _round_i in range(5):
                data, used_model = await _complete_with_failover(
                    messages,
                    [used_model],
                    broadcast,
                    job_id,
                    agent["id"],
                    on_token=on_token,
                    on_think=on_think,
                    with_tools=allow_tools,
                )
                choice = (data.get("choices") or [{}])[0]
                msg = _message_from_choice(choice)
                tool_calls = msg.get("tool_calls") or []
                content = msg.get("content") or ""
                import catalog as _catalog

                content = _catalog.strip_thinking(content)
                if tool_calls:
                    messages.append(_assistant_tool_message(content, tool_calls))
                else:
                    messages.append({"role": "assistant", "content": content})

                if tool_calls:
                    for call in tool_calls:
                        fn = call.get("function") or {}
                        name = fn.get("name") or ""
                        raw_args = fn.get("arguments") or "{}"
                        args = _parse_tool_args(raw_args)
                        if name == "write_file" and not args.get("content"):
                            messages.append(
                                {
                                    "role": "tool",
                                    "tool_call_id": call.get("id") or name,
                                    "name": name,
                                    "content": "error: file content was cut off. Put the finished text in your reply instead of calling tools.",
                                }
                            )
                            continue
                        result = await _run_named_tool(ws, name, args or {}, job, agent, broadcast)
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.get("id") or name,
                                "name": name,
                                "content": result[:12_000],
                            }
                        )
                    local.materialize_site(ws, content)
                    gap = local.site_gap(ws)
                    if gap:
                        messages.append({"role": "user", "content": gap})
                        allow_tools = True
                        continue
                    allow_tools = False
                    continue

                if _use_tools(agent, prompt):
                    transcripts, leftover = await _apply_text_actions(
                        content, ws, job, agent, broadcast
                    )
                else:
                    leftover = await _save_desk_files(content, content, ws, job, agent, broadcast)
                    transcripts = []
                if transcripts:
                    gap = local.site_gap(ws)
                    if gap:
                        messages.append({"role": "user", "content": gap})
                        allow_tools = True
                        continue
                    messages.append(
                        {
                            "role": "user",
                            "content": "Put the finished answer in your reply now. No tools.",
                        }
                    )
                    if leftover and not _is_tool_slop(leftover):
                        leftover = _catalog.strip_thinking(leftover)
                        if leftover:
                            output_parts.append(leftover)
                    allow_tools = False
                    continue

                if leftover:
                    leftover = _catalog.strip_thinking(_catalog.collapse_repeats(leftover))
                    if _is_tool_slop(leftover):
                        leftover = _text_from_slop(leftover) if not allow_tools else ""
                    if leftover:
                        output_parts.append(leftover)
                        if not pump.streamed:
                            pump.push(leftover, "text")
                gap = local.site_gap(ws)
                if gap:
                    messages.append({"role": "user", "content": gap})
                    allow_tools = True
                    continue
                break

            final_text = "\n".join(output_parts).strip()
            import catalog as _catalog

            final_text = _catalog.strip_thinking(final_text)
            if _is_tool_slop(final_text):
                final_text = _text_from_slop(final_text) if not _use_tools(agent, prompt) else ""
            if not final_text:
                recap = _workspace_recap(ws)
                if recap:
                    final_text = recap
                else:
                    try:
                        data, used_model = await _complete_with_failover(
                            [
                                {"role": "system", "content": _system_prompt(agent)},
                                {
                                    "role": "user",
                                    "content": f"{prompt}\n\nWrite the finished answer now in complete sentences. No thinking. No tools.",
                                },
                            ],
                            [used_model],
                            broadcast,
                            job_id,
                            agent["id"],
                            on_token=on_token,
                            with_tools=False,
                        )
                        final_text = _catalog.strip_thinking(
                            ((_message_from_choice((data.get("choices") or [{}])[0]).get("content")) or "")
                        )
                    except zen.ZenError:
                        final_text = ""
            if _catalog.looks_cut_off(final_text):
                try:
                    data, used_model = await _complete_with_failover(
                        [
                            {"role": "assistant", "content": final_text},
                            {
                                "role": "user",
                                "content": "Continue from the exact point you stopped. Output only the rest of the finished answer. No thinking.",
                            },
                        ],
                        [used_model],
                        broadcast,
                        job_id,
                        agent["id"],
                        on_token=on_token,
                        with_tools=False,
                    )
                    extra = _catalog.strip_thinking(
                        ((_message_from_choice((data.get("choices") or [{}])[0]).get("content")) or "")
                    )
                    if extra and extra not in final_text:
                        final_text = f"{final_text.rstrip()}\n{extra}".strip()
                except zen.ZenError:
                    pass
            final_text = _done_text(_catalog.collapse_repeats(final_text), ws)
            if (not final_text or _is_junk_output(final_text)) and local.site_gap(ws) is None:
                files = sandbox.list_files(ws)
                if any(name.endswith((".html", ".htm")) for name in files):
                    final_text = "Built a page. Use View on this desk."
            if not final_text or _is_junk_output(final_text):
                final_text, used_model = await _salvage_answer(
                    job_id, agent, ws, broadcast, prompt, used_model, on_token
                )
            if not final_text or _is_junk_output(final_text):
                _block_job(job_id, agent, broadcast, "Couldn't finish that job. Assign it again.")
                return
            if not pump.streamed:
                pump.push(final_text, "text")
            await pump.close()
            await _finish(job_id, agent, ws, broadcast, final_text, used_model, prompt)
        finally:
            if not pump.task.done():
                await pump.close()
    except asyncio.CancelledError:
        current = db.get_job(job_id) or job
        _settle_cancel(job_id, current, broadcast)
        return
    except zen.ZenError as err:
        partial = ""
        pump_live = locals().get("pump")
        if pump_live is not None:
            partial = getattr(pump_live, "text", "") or ""
        _block_job(job_id, agent, broadcast, err.message or "The model couldn’t run.", output=partial)
        return
    except Exception:
        log.exception("job %s failed", job_id)
        token_cb = locals().get("on_token")
        recovered, used_model = await _salvage_answer(
            job_id,
            agent,
            ws,
            broadcast,
            prompt,
            used_model,
            token_cb if callable(token_cb) else None,
        )
        if recovered:
            await _finish(job_id, agent, ws, broadcast, recovered, used_model, prompt)
            return
        _block_job(job_id, agent, broadcast, "Couldn't finish that job. Assign it again.")

