"""Desk checks that do not need a model: a page, a game, and a plan."""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

import db  # noqa: E402
import harness  # noqa: E402
import local  # noqa: E402
import memory  # noqa: E402
import repos  # noqa: E402
import sandbox  # noqa: E402


PAGE = """<!DOCTYPE html>
<html><head><link rel="stylesheet" href="styles.css"></head>
<body><button id="start-btn">Start</button><canvas id="gameCanvas" width="800" height="600"></canvas>
<script src="script.js"></script></body></html>
"""
CSS = ".hidden{display:none} button{cursor:pointer} body{margin:0;background:#111;color:#fff}"
JS = """
const start = document.getElementById("start-btn");
start.addEventListener("click", () => start.classList.add("hidden"));
"""
PLAN = '{"name":"write_file","arguments":{"path":"plan.md","content":"1. Open the list.\\n2. Assign the desk.\\n3. Review the file."}}'


def main() -> int:
    with tempfile.TemporaryDirectory() as raw:
        ws = Path(raw)
        sandbox.write_file(ws, "index.html", PAGE)
        sandbox.write_file(ws, "styles.css", CSS)
        sandbox.write_file(ws, "script.js", JS)
        if local.site_gap(ws):
            print("website gap", local.site_gap(ws))
            return 1
        page = local.playable_page(ws, sandbox.read_file(ws, "index.html"), base="http://127.0.0.1:8000/site/")
        if "styles.css" not in page or "script.js" not in page:
            print("view dropped css or js")
            return 1
        if "desk-game" in page:
            print("view replaced a finished script")
            return 1
        if not local.js_looks_complete(JS) or "start-btn" not in JS:
            print("game script is not wired")
            return 1
        broken = ws / "script.js"
        broken.write_text("function start(){ if (true) {", encoding="utf-8")
        gap = local.site_gap(ws)
        if not gap or "script.js" not in gap:
            print("cut-off script was accepted", gap)
            return 1

    plan = harness._text_from_slop(PLAN)
    if "Assign the desk" not in plan:
        print("plan text was dropped", plan)
        return 1
    if harness._use_tools({"strengths": ["planning"]}, "Write a plan"):
        print("planning received tools")
        return 1

    db.init_db()
    storm = db.create_project(
        {
            "name": "Stormcast",
            "organization": "example",
            "project": "Stormcast",
            "repository": "app",
            "branch": "main",
        }
    )
    other = db.create_project(
        {
            "name": "Other",
            "organization": "example",
            "project": "Other",
            "repository": "app",
            "branch": "main",
        }
    )
    try:
        root = repos.cache_dir(storm["id"])
        (root / ".git").mkdir(exist_ok=True)
        (root / "src").mkdir(exist_ok=True)
        (root / "src" / "app.py").write_text("def storm():\n    return 1\n", encoding="utf-8")
        db.remember(
            project_id=storm["id"],
            job_id="cade-job",
            agent_id="cade",
            agent_name="Cade",
            task="Code the Stormcast parser",
            status="done",
            body="Cade wrote the parser in src/app.py",
            files=["src/app.py"],
        )
        agent = {"id": "hamza", "name": "Hamza", "strengths": ["writing"], "instructions": "", "description": ""}
        prompt = harness._system_prompt(agent, db.get_project(storm["id"]), "hamza-job")
        if "Project: Stormcast" not in prompt or "Earlier on this project" not in prompt or "Cade" not in prompt:
            print("stormcast prompt missing memory", prompt[:400])
            return 1
        other_prompt = harness._system_prompt(agent, db.get_project(other["id"]), "")
        if "Cade" in other_prompt:
            print("other project saw Cade")
            return 1
        if repos.read_file(storm["id"], "../.env") != "error: path refused":
            print("path escape was allowed")
            return 1
        if "path refused" not in repos.read_file(storm["id"], "C:/Windows/win.ini"):
            print("absolute path was allowed")
            return 1
        import os

        os.environ["AZURE_DEVOPS_PAT"] = "secret-token-value"
        if "secret-token-value" in prompt:
            print("token leaked into the prompt")
            return 1
        before = len(db.list_memories(storm["id"], limit=20))
        memory.remember_job({"id": "x", "project_id": "", "prompt": "hi"}, agent, "answer", [])
        if len(db.list_memories(storm["id"], limit=20)) != before:
            print("memory written without a project")
            return 1
    finally:
        db.delete_project(other["id"])
        with db._lock:
            con = db.connect()
            con.execute("DELETE FROM memories WHERE project_id=?", (storm["id"],))
            con.commit()
            con.close()
        shutil.rmtree(repos.cache_dir(storm["id"]), ignore_errors=True)
        db.delete_project(storm["id"])

    print("quality ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
