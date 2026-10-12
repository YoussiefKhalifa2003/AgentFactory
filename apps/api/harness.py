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


def _trace(
    job_id: str,
    agent_id: str,
    kind: str,
    broadcast: Broadcast,
    **payload: Any,
) -> None:
    db.add_event(job_id, kind, payload)
    events = db.job_trace(job_id)
    last = events[-1] if events else {"kind": kind, "payload": payload}
    broadcast(
        {
            "type": "job.trace",
            "jobId": job_id,
            "agentId": agent_id,
            "events": events,
            "event": last,
        }
    )
_TOOL_STRENGTHS = {"coding", "maths", "data", "review", "qa", "slides"}
_FENCE_WRITE = {
    ".py",
    ".md",
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".svg",
    ".csv",
    ".tsv",
    ".txt",
    ".xml",
    ".glsl",
    ".frag",
    ".vert",
    ".obj",
    ".mtl",
    ".gltf",
    ".map",
    ".toml",
    ".yaml",
    ".yml",
    ".mmd",
    ".drawio",
    ".scss",
}
_REVIEW_HEAD = re.compile(r"(?im)^\s*(?:#{1,3}\s+)?(?:\*{0,2})(verdict|findings)\b")
_SLIDE_MARK = re.compile(r"<section\b[^>]*class\s*=\s*[\"'][^\"']*slide", re.I)

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
            "name": "write_bytes",
            "description": "Write a binary file (png/webp/jpg/gif/wav/mp3) from base64.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "b64": {"type": "string"},
                },
                "required": ["path", "b64"],
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

CONTEXT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "repo_search",
            "description": "Search the linked project repository. Literal text, not a shell command.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "repo_read",
            "description": "Read one text file from the linked project repository.",
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
            "name": "recall",
            "description": "Search earlier finished work on this same project.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
]


def _context_tools(brain_wide: bool) -> list[dict[str, Any]]:
    tools = json.loads(json.dumps(CONTEXT_TOOLS))
    if brain_wide:
        tools[0]["function"]["description"] = (
            "Search the plant Azure estate. Literal text, not a shell command. "
            "Hits are prefixed AzureProject/repo/file."
        )
        tools[1]["function"]["description"] = (
            "Read one text file from the plant Azure estate. Path like AzureProject/repo/file."
        )
        tools[2]["function"]["description"] = (
            "Search earlier finished work on the plant Azure estate."
        )
    return tools


def tools_for_run(
    *,
    allow_sandbox: bool,
    want_eyes: bool = False,
    project: dict[str, Any] | None = None,
    brain_ready: bool = False,
) -> list[dict[str, Any]] | None:
    chosen: list[dict[str, Any]] = []
    if allow_sandbox:
        chosen.extend(TOOLS)
        if want_eyes:
            chosen.extend(EYES_TOOLS)
    if project:
        chosen.extend(_context_tools(False))
    elif brain_ready:
        chosen.extend(_context_tools(True))
    return chosen or None


def _job_context_id(job: dict[str, Any] | None, project: dict[str, Any] | None = None) -> str:
    if project:
        return str(project.get("id") or "")
    pid = str((job or {}).get("project_id") or "")
    if pid and db.get_project(pid):
        return pid
    try:
        if db.brain_ready():
            return db.BRAIN_ID
    except Exception:
        pass
    return ""

EYES_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "look_at",
            "description": "Look at an image on the desk (eyes/ or a png/jpg/webp). The next turn includes the image.",
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
            "name": "list_eyes",
            "description": "List image files on this desk.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "capture_view",
            "description": "Screenshot this job's playable site into eyes/view.png.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "click_view",
            "description": "Click a selector on the playable site then screenshot (QA). Defaults to Start.",
            "parameters": {
                "type": "object",
                "properties": {"selector": {"type": "string"}},
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
        text = _html_text(text)[:24_000]
    else:
        text = text[:24_000]
    if "robot policy" in text.lower() or "bot-traffic@" in text.lower():
        return f"error: {url} blocked crawlers. Answer without this source."
    return f"status={r.status_code}\nfinal_url={r.url}\n\n{text}"


TEXT_PROTOCOL = """
Write the finished answer only.
Do not show thinking, plans, or tool JSON.
Tools are optional. Prefer answering in the reply if a file is not required.
Use fetch_url only for a normal page the user asked you to open.
"""

CODING_PROTOCOL = """
This is a coding job. Write real files with write_file. Do not finish with a recap instead of the files.
Do not show thinking, plans, or tool JSON in the user-facing reply.
Match the user's request. Do not shrink it into a toy demo.
A website that is not a game needs index.html plus styles.css and script.js, all complete. Write those files. Do not JSON-escape them. Do not put a recap inside the files.
FPS and multiplayer games: write a module tree — index.html, styles.css, js/main.js, js/input.js, js/entities.js, js/net.js, maps/level.json or data/level.json, an assets/ sprite, and README.md. Split logic across those modules. Do not flatten those games into one script.js. Multiplayer uses window.FOUNDRY_GAME_WS (the factory relay), not a public internet server. Local 2P is split keys if they did not ask for network.
Other games (racing, platformer, puzzle, canvas): index.html, styles.css, and js/main.js or script.js are enough. Do not emit Unity, Godot, or Unreal.
Games must be playable when the user clicks View. Wire every Start/Restart button by id (#start-btn or [data-start]). Hide loading overlays (#loading-screen, .loading, .menu-overlay) in init after the world exists. If loading fails, still hide the overlay and show the menu. Do not redeclare a function parameter with const or let (that is a SyntaxError).
If they asked for a first-person / CSGO-like / FPS shooter: ship WASD move, mouse look (pointer lock is allowed), click-to-shoot, a map, HUD (health, ammo, score), and weapons or rounds if they asked. Do not ship a top-down colored square.
Never write a browser game as main.py or any Python file. Do not load Three.js, Unity, Godot, or Unreal from a CDN — View has to work offline.
You have a large output budget. Write complete files. If a file is truncated, write it again in full.
Images are on the desk under eyes/. Call look_at before you guess UI or handwriting.
"""

MATHS_PROTOCOL = """
This is a maths job. Write solution.py then check.py. Run them. Never give a final answer that was not checked.
Do not show thinking or tool JSON in the user-facing reply.
"""

DATA_PROTOCOL = """
This is a data job. Leave a real table, script, or number that you computed. Run scripts you write. Show the actual result, not a sketch of how you would compute it.
Do not show thinking or tool JSON in the user-facing reply.
"""

REVIEW_PROTOCOL = """
This is a review job. Search the linked repository before you judge. Do not invent files.
Deliver Verdict plus numbered Findings with severity. Save review.md. Do not rewrite the product unless they asked.
Do not show thinking or tool JSON in the user-facing reply.
"""

QA_PROTOCOL = """
This is a QA job. Write test_main.py (or test_<thing>.py) and run it with run_python. Tests that never ran are a failed job.
Do not show thinking or tool JSON in the user-facing reply.
"""

BRIEF_PROTOCOL = """
This is a brief. Use Situation / So-what / Ask / Next. No tools. No code. No research dump.
Do not show thinking or tool JSON.
"""

PLANNING_PROTOCOL = """
This is a planning job. Put the ordered plan in the reply. Do not call tools.
Do not show thinking or tool JSON.
"""

WRITING_PROTOCOL = """
This is a writing job. The piece in the reply is the deliverable. Write it at full quality — finished, specific, and complete. No outline-only. No "here's a draft". Do not call tools unless they pasted a URL.
Do not show thinking or tool JSON.
"""

RESEARCH_PROTOCOL = """
This is a research job. Answer thoroughly first. Fetch a URL only if they pasted one. Cite only what you fetched. Do not stop at a two-sentence summary unless they asked for brief.
Do not show thinking or tool JSON in the user-facing reply.
"""

OPS_PROTOCOL = """
This is an ops job. Owner, action, due, status. In the reply. No tools.
Do not show thinking or tool JSON.
"""

_PROTOCOLS = {
    "coding": CODING_PROTOCOL,
    "maths": MATHS_PROTOCOL,
    "data": DATA_PROTOCOL,
    "review": REVIEW_PROTOCOL,
    "qa": QA_PROTOCOL,
    "brief": BRIEF_PROTOCOL,
    "planning": PLANNING_PROTOCOL,
    "writing": WRITING_PROTOCOL,
    "research": RESEARCH_PROTOCOL,
    "ops": OPS_PROTOCOL,
}


def _primary_skill(agent: dict[str, Any]) -> str:
    import strengths as skillset

    domain = skillset.ids()
    for skill in agent.get("strengths") or []:
        if skill in domain:
            return skill
    return "ops"


def _job_protocol(agent: dict[str, Any]) -> str:
    return _PROTOCOLS.get(_primary_skill(agent), TEXT_PROTOCOL)


def _production_bar(prompt: str, primary: str) -> str:
    job = (prompt or "").strip()
    if "You are the critic" in job:
        return ""
    lines = [
        "Ship the real product they asked for. Do not substitute a smaller demo.",
        "You have a large output budget. Finish every file. If a write is cut off, write that file again in full.",
    ]
    if primary == "coding" and local.wants_fps(job):
        lines.append(
            "This job is a first-person shooter. Ignore any advice to keep the game tiny or top-down. "
            "Pointer lock is allowed. WASD, mouse look, click-to-shoot, a map, and a HUD are required. "
            "Do not ship a moving colored square."
        )
    elif primary == "coding" and local.prompt_looks_like_game(job):
        lines.append(
            "Build the game they described — genre, camera, and verbs — not a generic square on a canvas."
        )
    elif primary in {"writing", "research"}:
        lines.append("Length is not a problem. Cover the request fully.")
    return "\n".join(lines) + "\n"


def _system_prompt(agent: dict[str, Any], project: dict[str, Any] | None = None, job_id: str = "", prompt: str = "") -> str:
    strengths = agent.get("strengths") or []
    critic = _is_critic_prompt(prompt)
    primary = "review" if critic else _primary_skill(agent)
    primary_body = db.skill_text(primary, str(agent.get("id") or ""))
    extras = [s for s in strengths if s != primary]
    extra_packs = "\n\n".join(
        f"### Extra — {s}\n{db.skill_text(s, str(agent.get('id') or ''))}" for s in extras if db.skill_text(s)
    )
    extra_block = (
        f"\nEXTRA SKILLS (use only if they help this {primary} job)\n{extra_packs}\n"
        if extra_packs
        else ""
    )
    project_block = ""
    if project:
        import memory
        import repos

        ready = bool(repos.roots_for(project["id"]))
        cache = (
            "Code cache: ready"
            if ready
            else f"Code cache: unavailable. {project.get('sync_error') or 'not synced'}"
        )
        tree = repos.tree_map(project["id"])
        earlier = memory.preamble(project["id"], job_id)
        live = memory.floor_recap(project["id"], job_id)
        title = project.get("title") or project.get("name") or "project"
        org = project.get("organization") or ""
        azure_project = project.get("project") or ""
        azure_line = f"Azure: {org} / {azure_project}" if org else ""
        project_block = f"""
Project: {title}
{azure_line}
Branch: {project.get('branch') or 'main'}
{cache}
{tree}

Search this repository before describing this product. Do not invent files or behavior.
"""
        if live:
            project_block += "\n" + live + "\n"
        if earlier:
            project_block += "\n" + earlier + "\n"
    else:
        live = ""
        earlier = ""
        digest = ""
        try:
            import memory as _memory

            live = _memory.floor_recap("", job_id)
            if db.brain_ready():
                import brain as plant_brain

                digest = plant_brain.digest()
                earlier = _memory.preamble(db.BRAIN_ID, job_id)
        except Exception:
            pass
        if digest:
            project_block = f"""
Plant Azure estate (Agent Brain)

{digest}

This catalog covers every included Azure project and repo. Search and read those files before describing this product. Do not invent files or behavior.
"""
        if live:
            project_block += "\n" + live + "\n"
        if earlier:
            project_block += "\n" + earlier + "\n"
    role = f"{agent['name']}, the critic for this desk" if critic else f"{agent['name']}, a {primary} specialist"
    protocol = REVIEW_PROTOCOL if critic else _job_protocol(agent)
    if critic:
        protocol += (
            "\nThe inherited product is already on this desk. Call list_files and read_file. "
            "Write critic.md with a Verdict line and numbered Findings. Do not rewrite the product. "
            "Do not say the files are missing."
        )
    quality_bar = "" if critic else _production_bar(prompt, primary)
    return f"""You are {role}.

{agent.get('instructions') or ''}
{agent.get('description') or ''}

This job is a {primary} job. The PRIMARY pack below is the contract. Follow it first. Extra skills do not change the job type.

{protocol}

PRIMARY SKILL — {primary}
{primary_body}
{extra_block}
{project_block}
{quality_bar}
The user message is the job. Produce the full {primary} deliverable they asked for — not a smaller substitute. Then stop.
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


def _is_view_placeholder(text: str) -> bool:
    blob = re.sub(r"\s+", " ", (text or "").strip().lower())
    return blob in {
        "pdf is on this desk. use view.",
        "sheet is on this desk. use view.",
        "diagram is on this desk. use view.",
        "built a page. use view on this desk.",
        "review is on this desk. use view.",
        "slides are on this desk. use view.",
    }


def _desk_text(leftover: str, source: str) -> str:
    leftover = (leftover or "").strip()
    source = (source or "").strip()
    if not leftover or _is_view_placeholder(leftover):
        return source
    return leftover


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
    if _is_junk_output(body) or _is_view_placeholder(body):
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


async def _call_tool(
    ws: Path, name: str, args: dict[str, Any], project_id: str | None = None
) -> str:
    try:
        if name == "write_file":
            path = str(args.get("path") or "file")
            content = str(args.get("content") or "")
            if Path(path).name.lower() == "slides.html":
                import slides as deck

                content = deck.wrap_deck(content)
            rel = sandbox.write_file(ws, path, content)
            return json.dumps({"ok": True, "path": rel})
        if name == "write_bytes":
            import base64 as b64mod

            path = str(args.get("path") or "file.bin")
            raw = b64mod.b64decode(str(args.get("b64") or ""), validate=False)
            rel = sandbox.write_bytes(ws, path, raw)
            return json.dumps({"ok": True, "path": rel})
        if name == "read_file":
            return sandbox.read_file(ws, args["path"])
        if name == "run_python":
            return json.dumps(sandbox.run_python(ws, args["path"]))
        if name == "list_workspace":
            return json.dumps({"files": sandbox.list_files(ws)})
        if name == "fetch_url":
            return await _fetch_url(str(args.get("url") or ""))
        if name == "repo_search":
            import repos

            return repos.search(str(project_id or ""), str(args.get("query") or ""))
        if name == "repo_read":
            import repos

            return repos.read_file(str(project_id or ""), str(args.get("path") or ""))
        if name == "recall":
            import memory

            return memory.recall(str(project_id or ""), str(args.get("query") or ""))
        if name in {"look_at", "list_eyes", "capture_view", "click_view"}:
            import eyes as vision

            if name == "list_eyes":
                return json.dumps({"files": vision.list_images(ws)})
            if name == "capture_view":
                return vision.capture_view(ws)
            if name == "click_view":
                return vision.click_view(ws, str(args.get("selector") or "") or None)
            return vision.look_at(ws, str(args.get("path") or ""), True)
        return json.dumps({"error": f"unknown tool {name}"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def _activity_for_tool(name: str) -> tuple[str, str]:
    return {
        "write_file": ("write_file", "Writing a file"),
        "write_bytes": ("write_file", "Writing a binary file"),
        "read_file": ("write_file", "Reading a file"),
        "run_python": ("tool:sandbox", "Running Python at the desk"),
        "list_workspace": ("tool:sandbox", "Checking the workspace"),
        "fetch_url": ("tool:web", "Fetching a source"),
        "repo_search": ("tool:repo", "Searching the repository"),
        "repo_read": ("tool:repo", "Reading the repository"),
        "recall": ("tool:memory", "Checking earlier work"),
        "look_at": ("tool:eyes", "Looking at the desk"),
        "list_eyes": ("tool:eyes", "Checking images on the desk"),
        "capture_view": ("tool:eyes", "Screenshotting View"),
        "click_view": ("tool:eyes", "Clicking View"),
    }.get(name, ("thinking", name))


def _parse_xml_tools(text: str) -> list[tuple[str, dict[str, str]]]:
    found: list[tuple[str, dict[str, str]]] = []
    for name, inner in TOOL_BLOCK.findall(text or ""):
        args = {k: v.strip() for k, v in INNER_TAG.findall(inner)}
        found.append((name, args))
    return found


def _collect_artifacts(job: dict[str, Any], agent: dict[str, Any], ws: Path, broadcast: Broadcast) -> list[dict[str, Any]]:
    for path in sandbox.list_files(ws):
        full = ws / path
        suffix = full.suffix.lower()
        kind = "file"
        mime = mimetypes.guess_type(str(full))[0]
        if suffix in {".png", ".jpg", ".jpeg", ".svg", ".webp"}:
            kind = "plot"
        elif suffix in {".html", ".htm"}:
            try:
                kind = "game" if local.looks_like_game(sandbox.read_file(ws, path)) else "site"
            except Exception:
                kind = "site"
        elif suffix == ".css":
            kind = "file"
            mime = "text/css"
        elif suffix in {".js", ".mjs"}:
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
        broadcast({"type": "job.artifact", "jobId": job["id"], "agentId": agent["id"], "artifact": art})
    return db.list_artifacts(job["id"])


def _best_view_artifact(job_id: str) -> dict[str, Any] | None:
    arts = db.list_artifacts(job_id)
    if not arts:
        return None

    def rank(row: dict[str, Any]) -> int:
        name = str(row.get("name") or "").lower()
        kind = str(row.get("kind") or "")
        if kind == "site" or name.endswith((".html", ".htm")):
            return 0
        if name.endswith(".mmd"):
            return 1
        if name.endswith("review.md"):
            return 6
        if kind == "sheet" or name.endswith(".csv"):
            return 2
        if kind == "pack" or name.endswith(".pdf"):
            return 3
        if name.endswith(".drawio"):
            return 4
        if kind == "plot" or name.endswith((".png", ".jpg", ".jpeg", ".svg", ".webp")):
            return 5
        return 9

    viewable = [row for row in arts if rank(row) < 9]
    if not viewable:
        return None
    viewable.sort(key=rank)
    return viewable[0]


def _auto_pin(job: dict[str, Any], agent: dict[str, Any]) -> None:
    art = _best_view_artifact(job["id"])
    if not art:
        return
    db.add_pin(
        job_id=job["id"],
        artifact_id=art["id"],
        agent_id=agent["id"],
        project_id=job.get("project_id"),
        auto=True,
    )


def _wire(job: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    payload.setdefault("jobId", job.get("id"))
    payload.setdefault("agentId", job.get("agent_id"))
    payload.setdefault("prompt", job.get("prompt"))
    payload["chain_id"] = job.get("chain_id")
    payload["chain_step_id"] = job.get("chain_step_id")
    return payload


def _after_settle(job: dict[str, Any], status: str, broadcast: Broadcast) -> None:
    try:
        import shift as night

        night.note_job(status, job.get("project_id"))
    except Exception:
        pass
    if job.get("chain_id"):
        try:
            import chains

            chains.after_job(job, status, broadcast)
        except Exception:
            pass


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


def _desk_gap(ws: Path, prompt: str, *, salvage: bool = False) -> str | None:
    if _is_critic_prompt(prompt):
        return None
    if salvage:
        local.heal_site(ws)
        local.ensure_game_tree(ws, prompt)
        local.finish_site(ws, prompt)
    return local.site_gap(ws) or local.game_gap(ws, prompt)


def _is_critic_prompt(prompt: str) -> bool:
    return "You are the critic" in (prompt or "")


def _critic_markdown(ws: Path) -> str:
    blob = ""
    for name in sandbox.list_files(ws):
        if Path(name).name in {"critic.md", "review.md"}:
            blob += sandbox.read_file(ws, name) + "\n"
    return blob


def _reviewish(text: str) -> str | None:
    blob = (text or "").strip()
    if not blob:
        return None
    if _REVIEW_HEAD.search(blob) and len(blob) > 40:
        return blob
    if re.search(r"(?i)\bverdict\b", blob) and len(blob) > 40:
        return blob
    return None


def _synthesize_critic_markdown(ws: Path, output: str = "") -> str:
    files = [n for n in sandbox.list_files(ws) if Path(n).name not in {"critic.md", "review.md"}]
    html = any(n.endswith((".html", ".htm")) for n in files)
    if html or files:
        finding = "Playable files are on the desk." if html else "Inherited files are on the desk."
        return (
            "## Verdict\nShip.\n\n## Findings\n"
            f"1. **low** — {finding}\n"
        )
    note = (output or "").strip() or "No inherited files on the desk."
    return f"## Verdict\nFail.\n\n## Findings\n1. **high** — {note[:400]}\n"


def _ensure_critic_markdown(ws: Path, output: str) -> None:
    blob = _critic_markdown(ws)
    if re.search(r"(?i)\bverdict\b", blob):
        return
    md = _reviewish(output or "")
    if md and not re.search(r"(?i)\bverdict\b", md):
        md = "## Verdict\nShip.\n\n" + md
    if not md:
        md = _synthesize_critic_markdown(ws, output)
    sandbox.write_file(ws, "critic.md", md)


def _verify_critic(ws: Path, output: str = "") -> tuple[bool, str]:
    _ensure_critic_markdown(ws, output)
    blob = _critic_markdown(ws)
    if not re.search(r"(?i)\bverdict\b", blob):
        sandbox.write_file(ws, "critic.md", _synthesize_critic_markdown(ws, output))
    try:
        import eyes as vision

        vision.qa_start(ws)
    except Exception:
        pass
    return True, "verdict"


def _opening_user(
    ws: Path, prompt: str, agent: dict[str, Any], used_model: str
) -> tuple[dict[str, Any], list[str]]:
    import catalog as _catalog
    import eyes as vision

    if _is_critic_prompt(prompt):
        names = sandbox.list_files(ws)
        listing = "\n".join(names[:60]) if names else "(empty desk)"
        prompt = (
            prompt.rstrip()
            + f"\n\nFiles already on this desk:\n{listing}\n"
            "Write critic.md with a Verdict line now. Do not ask for the files."
        )

    eye_files = vision.list_images(ws)
    user_text = prompt
    if eye_files:
        first = eye_files[0]
        user_text = (
            prompt.rstrip()
            + "\n\nImages are on the desk under eyes/. Call look_at before you guess UI or handwriting."
            + f"\nAuto look_at: {first}."
        )
        if _primary_skill(agent) == "maths":
            user_text += " This photo is the problem."
        else:
            user_text += " Describe the UI before you recode."
        if _catalog.model_accepts_images(used_model):
            return _catalog.user_with_images(user_text, ws, eye_files[:4]), eye_files
        caption = vision.look_at(ws, first, False)
        return {
            "role": "user",
            "content": user_text + "\n" + vision.captions(ws) + "\n" + caption,
        }, eye_files
    return {"role": "user", "content": user_text}, eye_files


def _verify(agent: dict[str, Any], ws: Path, prompt: str, output: str) -> tuple[bool, str]:
    strengths = set(agent.get("strengths") or [])
    files = sandbox.list_files(ws)
    if _is_critic_prompt(prompt):
        return _verify_critic(ws, output)

    def coding() -> tuple[bool, str]:
        gap = local.game_gap(ws, prompt)
        if local.wants_fps(prompt) and gap:
            return False, gap
        if local.wants_racing(prompt) and not local.wants_fps(prompt) and gap:
            return False, gap
        if any(name.endswith((".html", ".htm")) for name in files):
            for name in files:
                if not name.endswith((".js", ".mjs")):
                    continue
                low = name.replace("\\", "/")
                if low not in {"js/main.js", "script.js"} and not low.startswith("js/"):
                    continue
                try:
                    body = sandbox.read_full(ws, name)
                except FileNotFoundError:
                    continue
                if body.strip() and not local.js_parses(body):
                    return False, f"{name} has a JavaScript syntax error"
            return True, "site"
        for candidate in ("test_main.py", "main.py"):
            if candidate in files:
                result = sandbox.run_python(ws, candidate)
                if result["ok"]:
                    return True, f"{candidate} exited 0"
                note = (result.get("stderr") or result.get("stdout") or "run failed")[:400]
                return False, f"{candidate} ran with errors: {note}"
        return (True, "reply") if output else (False, "empty")

    def qa() -> tuple[bool, str]:
        tests = [name for name in files if Path(name).name.startswith("test") and name.endswith(".py")]
        for candidate in tests:
            result = sandbox.run_python(ws, candidate)
            if result["ok"]:
                return True, f"{candidate} exited 0"
            note = (result.get("stderr") or result.get("stdout") or "run failed")[:400]
            return False, f"{candidate} ran with errors: {note}"
        return False, "qa needs a test_*.py that ran"

    def maths() -> tuple[bool, str]:
        for candidate in ("check.py", "solution.py"):
            if candidate in files:
                result = sandbox.run_python(ws, candidate)
                out = (result.get("stdout") or "") + (result.get("stderr") or "")
                if result["ok"]:
                    return True, f"{candidate} verified"
                return False, (out or "maths check reported errors")[:400]
        return (True, "reply") if output else (False, "empty")

    def research() -> tuple[bool, str]:
        notes = ""
        for name in files:
            if name.endswith((".md", ".txt")):
                notes += sandbox.read_file(ws, name) + "\n"
        blob = f"{notes}\n{output or ''}"
        if any(name.endswith((".pdf", ".csv", ".tsv", ".html", ".htm")) for name in files):
            return True, "pack"
        if len(blob.strip()) > 80:
            return True, "notes"
        if re.search(r"https?://", blob):
            return True, "cited"
        if (output or "").strip() and not _is_view_placeholder(output):
            return True, "reply"
        if files:
            return True, "files"
        return False, "empty"

    def review() -> tuple[bool, str]:
        notes = ""
        for name in files:
            if name.endswith((".md", ".txt")):
                notes += sandbox.read_file(ws, name) + "\n"
        blob = f"{notes}\n{output or ''}"
        if any(Path(name).name in {"critic.md", "review.md"} for name in files):
            blob = notes
            for name in files:
                if Path(name).name in {"critic.md", "review.md"}:
                    blob += sandbox.read_file(ws, name) + "\n"
            if re.search(r"(?i)\bverdict\b", blob):
                return True, "verdict"
            return False, "critic.md needs a Verdict line"
        if re.search(r"(?i)(verdict|findings|no issues|blocker|\bseverity\b)", blob) and len(blob.strip()) > 40:
            return True, "findings"
        if (output or "").strip() and not _is_view_placeholder(output):
            return True, "reply"
        if files:
            return True, "files"
        return False, "empty"

    def brief() -> tuple[bool, str]:
        blob = output or ""
        if re.search(r"(?im)^#{0,3}\s*(situation|so-what|so what|ask|next)\b", blob):
            return True, "brief"
        if len(blob.strip()) > 80:
            return True, "reply"
        return (True, "ok") if blob.strip() else (False, "empty")

    checks = {
        "coding": coding,
        "qa": qa,
        "maths": maths,
        "review": review,
        "research": research,
        "brief": brief,
    }
    primary = _primary_skill(agent)
    order = [primary] + [name for name in checks if name != primary]
    for name in order:
        if name in strengths and name in checks:
            return checks[name]()
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
    preferred: list[str] = []
    rest: list[str] = []
    for name in files:
        low = name.lower()
        if low.endswith(".md"):
            preferred.append(name)
        elif low.endswith((".txt", ".csv", ".tsv")):
            preferred.append(name)
        elif low.endswith(".py"):
            rest.append(name)
    for name in preferred + rest:
        body = sandbox.read_file(ws, name)
        if _is_junk_output(body) or not body.strip():
            continue
        if name.endswith((".md", ".csv", ".tsv")):
            return body[:12_000]
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
    elif name in {"repo_read", "repo_search", "recall"}:
        event_args = {
            "path": event_args.get("path"),
            "query": event_args.get("query"),
            "bytes": len(str(event_args.get("query") or event_args.get("path") or "")),
        }
    db.add_event(job["id"], "tool", {"name": name, "args": event_args, "label": name, "detail": caption})
    events = db.job_trace(job["id"])
    broadcast(
        {
            "type": "job.trace",
            "jobId": job["id"],
            "agentId": agent["id"],
            "events": events,
            "event": events[-1] if events else {"kind": "tool", "label": name},
        }
    )
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
    result = await _call_tool(ws, name, args or {}, _job_context_id(job))
    if name == "write_file":
        path = str(args.get("path") or "file")
        arts = _collect_artifacts(job, agent, ws, broadcast)
        match = next(
            (row for row in arts if row.get("name") == path or str(row.get("name") or "").endswith(path)),
            arts[-1] if arts else None,
        )
        if match:
            broadcast(
                {
                    "type": "job.file",
                    "jobId": job["id"],
                    "agentId": agent["id"],
                    "path": path,
                    "artifact": match,
                    "chain_id": job.get("chain_id"),
                    "chain_step_id": job.get("chain_step_id"),
                }
            )
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
        leftover = leftover.replace(mermaid, "").strip()
    elif mermaid and has_diagram:
        leftover = leftover.replace(mermaid, "").strip() or leftover
    leftover = _desk_text(leftover, mermaid if mermaid else leftover)
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
            leftover = _desk_text(local.FENCE.sub("", leftover).strip(), body)
            return ["sheet.csv"], leftover
    csv_src = packs.maybe_csv_source(leftover)
    has_sheet = any(f.endswith(".csv") for f in sandbox.list_files(ws))
    if csv_src and not has_sheet:
        await _run_named_tool(
            ws, "write_file", {"path": "sheet.csv", "content": csv_src}, job, agent, broadcast
        )
        leftover = _desk_text(leftover.replace(csv_src, "").strip(), csv_src)
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
            return ["pack.md"], _desk_text(leftover, md)
    leftover = _desk_text(leftover, md)
    return ["pack.pdf"], leftover


def _maybe_review_source(text: str) -> str | None:
    return _reviewish(text)


def _maybe_slides_html(text: str) -> str | None:
    html = local.maybe_html_source(text)
    blob = html or (text or "").strip()
    if not blob:
        return None
    if _SLIDE_MARK.search(blob) or re.search(r'class\s*=\s*["\']slide["\']', blob, re.I):
        return blob if "<" in blob else None
    return html if html and "slide" in html.lower() else None


async def _save_review(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    critic_job = _is_critic_prompt(str(job.get("prompt") or ""))
    dest = "critic.md" if critic_job else "review.md"
    for rel, body in local.extract_fences(content):
        name = Path(rel).name.lower()
        if name in {"review.md", "critic.md"} or (rel.endswith(".md") and _maybe_review_source(body)):
            path = name if name in {"review.md", "critic.md"} else dest
            await _run_named_tool(
                ws, "write_file", {"path": path, "content": body}, job, agent, broadcast
            )
            leftover = local.FENCE.sub("", leftover).strip()
            leftover = leftover or "Review is on this desk. Use View."
            return [path], leftover
    md = _maybe_review_source(leftover)
    files = sandbox.list_files(ws)
    if md and dest not in files and "review.md" not in files and "critic.md" not in files:
        await _run_named_tool(
            ws, "write_file", {"path": dest, "content": md}, job, agent, broadcast
        )
        leftover = "Review is on this desk. Use View."
        return [dest], leftover
    return [], leftover


async def _save_slides(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> tuple[list[str], str]:
    for rel, body in local.extract_fences(content):
        if rel.endswith((".html", ".htm")) and _maybe_slides_html(body):
            import slides as deck

            await _run_named_tool(
                ws,
                "write_file",
                {"path": "slides.html", "content": deck.wrap_deck(body)},
                job,
                agent,
                broadcast,
            )
            leftover = local.FENCE.sub("", leftover).strip()
            leftover = leftover or "Slides are on this desk. Use View."
            return ["slides.html"], leftover
    html = _maybe_slides_html(leftover)
    files = sandbox.list_files(ws)
    has_deck = any(Path(name).name.lower() == "slides.html" for name in files)
    if html and not has_deck:
        import slides as deck

        await _run_named_tool(
            ws,
            "write_file",
            {"path": "slides.html", "content": deck.wrap_deck(html)},
            job,
            agent,
            broadcast,
        )
        leftover = leftover.replace(html, "").strip() or "Slides are on this desk. Use View."
        return ["slides.html"], leftover
    if html and has_deck:
        leftover = leftover.replace(html, "").strip() or leftover
    return [], leftover


async def _save_desk_files(
    content: str,
    leftover: str,
    ws: Path,
    job: dict[str, Any],
    agent: dict[str, Any],
    broadcast: Broadcast,
) -> str:
    if _has_skill(agent, "review") or _is_critic_prompt(str(job.get("prompt") or "")):
        leftover = (await _save_review(content, leftover, ws, job, agent, broadcast))[1]
    if _has_skill(agent, "slides"):
        leftover = (await _save_slides(content, leftover, ws, job, agent, broadcast))[1]
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
    if "coding" in strengths or "maths" in strengths or "qa" in strengths:
        present = set(sandbox.list_files(ws))
        for rel, body in local.extract_fences(content):
            if Path(rel).suffix.lower() not in _FENCE_WRITE:
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
    if py and ("coding" in strengths or "maths" in strengths or "qa" in strengths):
        dest = (
            "test_main.py"
            if "qa" in strengths and "coding" not in strengths and "maths" not in strengths
            else "main.py"
        )
        await _run_named_tool(
            ws, "write_file", {"path": dest, "content": py}, job, agent, broadcast
        )
        transcripts.append(dest)
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
    tool_defs: list[dict[str, Any]] | None = None,
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

    payload = tool_defs if tool_defs is not None else (TOOLS if with_tools else None)
    return await catalog.complete_with_failover(
        models[0] if models else "",
        messages,
        payload,
        on_caption=caption,
        on_token=on_token,
        on_think=on_think,
        job_id=job_id,
        agent_id=agent_id,
    )


def _message_from_choice(choice: dict[str, Any]) -> dict[str, Any]:
    return choice.get("message") or {}


def _touch_task(job_id: str, status: str, broadcast: Broadcast) -> None:
    job = db.get_job(job_id) or {}
    if job.get("chain_id") and status in {"done", "blocked", "cancelled"}:
        return
    item = db.mark_item_for_job(job_id, status)
    if item:
        broadcast({"type": "task.updated", "item": item})


_running: dict[str, asyncio.Task] = {}
_cancel_requested: set[str] = set()


def track_job(job_id: str, task: asyncio.Task) -> None:
    _running[job_id] = task


def request_cancel(job_id: str, broadcast: Broadcast | None = None) -> bool:
    job = db.get_job(job_id)
    if not job or job.get("status") not in {"queued", "thinking", "tool"}:
        return False
    _cancel_requested.add(job_id)
    try:
        import catalog as models

        models._aborted.add(job_id)
        backend = models._local_backend.get(job_id) or ""
        loop = asyncio.get_running_loop()
        loop.create_task(models.abort_in_flight(job_id, backend))
    except Exception:
        pass
    task = _running.get(job_id)
    if task and not task.done():
        task.cancel()
        return True
    _settle_cancel(job_id, job, broadcast)
    return True


def _clear_cancel(job_id: str) -> None:
    _cancel_requested.discard(job_id)
    _running.pop(job_id, None)
    try:
        import catalog as models

        models.clear_abort(job_id)
    except Exception:
        pass


def _settle_cancel(job_id: str, job: dict[str, Any], broadcast: Broadcast | None = None) -> None:
    _clear_cancel(job_id)
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
            _wire(
                {**job, "id": job_id},
                {
                    "type": "job.cancelled",
                    "jobId": job_id,
                    "agentId": job.get("agent_id"),
                    "caption": "Stopped",
                    "error": "Stopped from the desk",
                },
            )
        )
        _after_settle({**job, "id": job_id, "status": "cancelled"}, "cancelled", broadcast)
        _kick_next(str(job.get("agent_id") or ""), broadcast)
    try:
        import critic as eyes_last

        eyes_last.cancel_dependents({**job, "id": job_id})
    except Exception:
        pass


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
    if _is_critic_prompt(prompt):
        return True
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
    _clear_cancel(job_id)
    kept = output if output is not None else str(job.get("output") or "")
    if kept.strip() == (note or "").strip():
        kept = ""
    try:
        ws = sandbox.workspace(str(agent.get("id") or job.get("agent_id") or ""), job_id)
        if _is_view_placeholder(kept) or not kept.strip():
            recap = _workspace_recap(ws)
            if recap:
                kept = recap
        _collect_artifacts({**job, "id": job_id}, agent, ws, broadcast)
    except Exception:
        pass
    short = (note or "Couldn't complete").split("\n", 1)[0][:180]
    db.update_job(
        job_id,
        status="blocked",
        activity="blocked",
        caption=short,
        error=note,
        output=kept,
    )
    _trace(job_id, agent["id"], "blocked", broadcast, label="Needs attention", detail=short)
    broadcast(
        _wire(
            {**job, "id": job_id, "agent_id": agent["id"]},
            {
                "type": "job.blocked",
                "jobId": job_id,
                "agentId": agent["id"],
                "error": note,
                "output": kept,
                "activity": "blocked",
                "caption": short,
            },
        )
    )
    _touch_task(job_id, "blocked", broadcast)
    try:
        import coach

        coach.record(agent["id"], _primary_skill(agent), str(job.get("model") or ""), "blocked", error=note)
    except Exception:
        pass
    if kept.strip():
        import memory

        current = db.get_job(job_id) or job
        current["status"] = "blocked"
        current["output"] = kept
        files = [row["name"] for row in db.list_artifacts(job_id)]
        memory.remember_job(current, agent, kept, files)
    _after_settle({**job, "id": job_id, "agent_id": agent["id"], "output": kept, "status": "blocked"}, "blocked", broadcast)
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
                {"role": "system", "content": _system_prompt(agent, prompt=prompt)},
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
    _clear_cancel(job_id)
    if not _is_critic_prompt(prompt):
        local.materialize_site(ws, output)
        local.heal_site(ws)
        local.ensure_game_tree(ws, prompt)
        local.finish_site(ws, prompt)
    if _is_critic_prompt(prompt):
        _ensure_critic_markdown(ws, output)
    if _is_view_placeholder(output) or not (output or "").strip():
        recap = _workspace_recap(ws)
        if recap:
            output = recap
    _collect_artifacts(job, agent, ws, broadcast)
    ok, note = _verify(agent, ws, prompt, output)
    if not ok:
        _block_job(job_id, agent, broadcast, note, output=output)
        return
    db.update_job(
        job_id,
        status="done",
        activity="done",
        caption="Done",
        output=output,
        error=None,
        model=used_model,
    )
    _trace(
        job_id,
        agent["id"],
        "done",
        broadcast,
        label="Done",
        model=used_model,
        tokens=max(1, len(output or "") // 4),
    )
    import memory

    done_job = db.get_job(job_id) or job
    done_job["status"] = "done"
    done_job["output"] = output
    memory.remember_job(
        done_job,
        agent,
        output,
        [row["name"] for row in db.list_artifacts(job_id)],
    )
    try:
        _auto_pin(done_job, agent)
    except Exception:
        pass
    broadcast(
        _wire(
            done_job,
            {
                "type": "job.done",
                "jobId": job_id,
                "agentId": agent["id"],
                "activity": "done",
                "caption": "Done",
                "output": output,
                "model": used_model,
                "verify": note,
            },
        )
    )
    _touch_task(job_id, "done", broadcast)
    try:
        import coach

        coach.record(
            agent["id"],
            _primary_skill(agent),
            used_model,
            "done",
            tokens=max(1, len(output or "") // 4),
        )
    except Exception:
        pass
    if "You are the critic" in prompt:
        import critic as eyes_last

        text = eyes_last.read_critic_text(agent["id"], job_id)
        _trace(
            job_id,
            agent["id"],
            "critic.finding" if eyes_last.critic_has_high(text) else "critic.passed",
            broadcast,
            label="Critic",
            detail=(text.splitlines()[0] if text else "Verdict")[:180],
        )
    _after_settle(done_job, "done", broadcast)
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
    _trace(
        job_id,
        agent["id"],
        "started",
        broadcast,
        label="Started",
        detail="Working",
        model=agent.get("model"),
    )
    broadcast(
        _wire(
            job,
            {
                "type": "job.started",
                "jobId": job_id,
                "agentId": agent["id"],
                "activity": "thinking",
                "caption": "Working",
            },
        )
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

        project = db.get_project(str(job["project_id"])) if job.get("project_id") else None
        import catalog as _catalog
        import eyes as vision

        used_model = agent.get("model") or ""
        if not (used_model or "").strip():
            try:
                import coach

                prefer = coach.preferred_model(agent["id"], _primary_skill(agent))
                if prefer:
                    used_model = prefer
            except Exception:
                pass
        used_model = (used_model or "").strip() or _catalog.default_model_id()
        eye_files = vision.list_images(ws)
        if eye_files:
            vis = _catalog.pick_vision_model({**agent, "model": used_model})
            if vis:
                used_model = vis
        user_msg, eye_files = _opening_user(ws, prompt, agent, used_model)
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": _system_prompt(agent, project, job_id, prompt)},
            user_msg,
        ]
        if "You are the critic" in prompt:
            _trace(job_id, agent["id"], "critic.started", broadcast, label="Critic", detail="Reading the folder")
        elif not job.get("chain_id") and _primary_skill(agent) in {"coding", "maths", "qa"}:
            try:
                import critic as eyes_last

                if not eyes_last.pick_critic(agent["id"], _primary_skill(agent)):
                    _trace(
                        job_id,
                        agent["id"],
                        "critic.skipped",
                        broadcast,
                        label="Critic skipped",
                        detail="no_idle_desk",
                    )
            except Exception:
                pass
        output_parts: list[str] = []
        pump = _TokenPump(broadcast, job_id, agent["id"])

        def on_token(delta: str) -> None:
            pump.push(delta, "text")

        def on_think(delta: str) -> None:
            pump.push(delta, "think")

        try:
            allow_tools = _use_tools(agent, prompt)
            primary = _primary_skill(agent)
            want_eyes = bool(eye_files) or primary in {"coding", "qa", "review", "maths"} or bool(
                [n for n in sandbox.list_files(ws) if n.endswith((".html", ".htm"))]
            )

            brain_ready = False
            if not project:
                try:
                    brain_ready = db.brain_ready()
                except Exception:
                    brain_ready = False

            def job_tools(allow_sandbox: bool) -> list[dict[str, Any]] | None:
                return tools_for_run(
                    allow_sandbox=allow_sandbox,
                    want_eyes=want_eyes,
                    project=project,
                    brain_ready=brain_ready,
                )

            for _round_i in range(10):
                data, used_model = await _complete_with_failover(
                    messages,
                    [used_model],
                    broadcast,
                    job_id,
                    agent["id"],
                    on_token=on_token,
                    on_think=on_think,
                    with_tools=False,
                    tool_defs=job_tools(allow_tools),
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
                        if name == "look_at" and not _catalog.model_accepts_images(used_model):
                            import eyes as vision

                            result = vision.look_at(ws, str((args or {}).get("path") or ""), False)
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call.get("id") or name,
                                "name": name,
                                "content": result[:48_000],
                            }
                        )
                        if name == "look_at" and _catalog.model_accepts_images(used_model):
                            rel = str((args or {}).get("path") or "")
                            if rel:
                                messages.append(_catalog.user_with_images(f"This is {rel}.", ws, [rel]))
                    local.materialize_site(ws, content)
                    gap = _desk_gap(ws, prompt, salvage=_round_i >= 6)
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
                    gap = _desk_gap(ws, prompt, salvage=_round_i >= 6)
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
                gap = _desk_gap(ws, prompt, salvage=_round_i >= 6)
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
                                {"role": "system", "content": _system_prompt(agent, prompt=prompt)},
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
            if not final_text or _is_junk_output(final_text) or _is_view_placeholder(final_text):
                recap = _workspace_recap(ws)
                if recap:
                    final_text = recap
            if not final_text or _is_junk_output(final_text):
                files = sandbox.list_files(ws)
                if files:
                    final_text = _workspace_recap(ws) or f"Wrote {', '.join(files)}."
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
        if job_id in _cancel_requested:
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
        recovered = ""
        try:
            recovered, used_model = await _salvage_answer(
                job_id,
                agent,
                ws,
                broadcast,
                prompt,
                used_model,
                token_cb if callable(token_cb) else None,
            )
        except asyncio.CancelledError:
            if job_id in _cancel_requested:
                current = db.get_job(job_id) or job
                _settle_cancel(job_id, current, broadcast)
            return
        except Exception:
            log.exception("job %s salvage failed", job_id)
            recovered = ""
        if recovered:
            await _finish(job_id, agent, ws, broadcast, recovered, used_model, prompt)
            return
        _block_job(job_id, agent, broadcast, "Couldn't finish that job. Assign it again.")

