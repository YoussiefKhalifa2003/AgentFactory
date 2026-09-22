"""Desk checks that do not need a model: a page, a game, and a plan."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

import harness  # noqa: E402
import local  # noqa: E402
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
    print("quality ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
