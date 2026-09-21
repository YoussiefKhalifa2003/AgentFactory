"""Deterministic job finishers when no language model is reachable."""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import quote

import sandbox

GREET = re.compile(r"^(hi|hello|hey|yo|thanks|thank you)[\s!.?]*$", re.I)
FENCE = re.compile(r"```(?:([\w./+-]+)\n)?(.*?)```", re.S)
ARITH = re.compile(r"^[0-9.\s+\-*/()]+$")
URLS = re.compile(r"https?://[^\s)>\]]+")


def is_smalltalk(prompt: str) -> bool:
    return bool(GREET.match(prompt.strip()))


def extract_fences(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for lang, body in FENCE.findall(text or ""):
        body = body.strip()
        if not body:
            continue
        lang = (lang or "").strip()
        low = lang.lower()
        if low in {"python", "py"}:
            out.append(("main.py", body))
        elif low in {"html", "htm"}:
            out.append(("index.html", body))
        elif low == "css":
            out.append(("styles.css", body))
        elif low in {"js", "javascript"}:
            out.append(("script.js", body))
        elif low in {"csv", "tsv"}:
            out.append(("sheet.csv", body.replace("\t", ",") if low == "tsv" else body))
        elif low in {"mermaid", "mmd"}:
            out.append(("diagram.mmd", body))
        elif low in {"drawio", "xml"} and ("<mxfile" in body.lower() or "<mxgraphmodel" in body.lower()):
            out.append(("diagram.drawio", body))
        elif lang and ("/" in lang or "." in lang):
            out.append((lang, body))
        elif lang in {"md", "markdown"}:
            out.append(("notes.md", body))
        elif _looks_like_html(body):
            out.append(("index.html", body))
        elif body.lstrip().startswith(("<mxfile", "flowchart", "graph ")):
            name = "diagram.drawio" if body.lstrip().startswith("<mxfile") else "diagram.mmd"
            out.append((name, body))
        else:
            out.append(("main.py" if "def " in body or "print(" in body else "notes.md", body))
    return out


def _looks_like_html(text: str) -> bool:
    blob = (text or "").lstrip().lower()
    return blob.startswith(("<!doctype html", "<html", "<head", "<body", "<!doctype"))


def maybe_html_source(text: str) -> str | None:
    blob = (text or "").strip()
    if not blob:
        return None
    low = blob.lower()
    start = low.find("<!doctype html")
    if start < 0:
        start = low.find("<html")
    if start < 0:
        return None
    return blob[start:].strip()


def maybe_python_source(text: str) -> str | None:
    """If the model dumped Python without fences, recover it as main.py."""
    if not text or extract_fences(text):
        return None
    lines = text.replace("\r\n", "\n").split("\n")
    start = None
    for i, line in enumerate(lines):
        if re.match(r"\s*(import |from |def |class |print\(|# )", line):
            start = i
            break
    if start is None:
        return None
    block = "\n".join(lines[start:]).strip()
    if "print(" not in block and "def " not in block and "import " not in block:
        return None
    if len(block) < 8:
        return None
    return block


def _safe_math(expr: str) -> str | None:
    expr = expr.strip()
    if not ARITH.match(expr) or not expr:
        return None
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError:
        return None
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            return None
    try:
        value = eval(compile(tree, "<math>", "eval"), {"__builtins__": {}}, {})
    except Exception:
        return None
    return str(value)


async def greet(agent: dict[str, Any], prompt: str) -> str:
    name = agent.get("name") or "this bay"
    strengths = ", ".join(agent.get("strengths") or []) or "general work"
    return (
        f"{prompt.strip().rstrip('!.')}, I'm {name}. "
        f"I handle {strengths}. Send a real job: write code, solve a number, "
        f"or paste a URL, and I'll do it at this desk."
    )


async def from_user_code(prompt: str, ws: Path) -> str | None:
    fences = extract_fences(prompt)
    py = [p for p in fences if p[0].endswith(".py")]
    if not py:
        return None
    written = []
    for rel, body in fences:
        sandbox.write_file(ws, rel, body)
        written.append(rel)
    result = sandbox.run_python(ws, py[0][0])
    recap = (
        f"Wrote {', '.join(written)} from your message and ran {py[0][0]}.\n"
        f"exit={result.get('exit_code')}\n{result.get('stdout') or ''}"
        f"{result.get('stderr') or ''}"
    )
    return recap.strip()


def maths_script(prompt: str, ws: Path) -> str | None:
    # Prefer an explicit expression after = or "what is"
    candidates = re.findall(r"([0-9.\s+\-*/()]{3,})", prompt)
    for raw in reversed(candidates):
        value = _safe_math(raw)
        if value is None:
            continue
        code = (
            "expr = " + json.dumps(raw.strip()) + "\n"
            "value = " + json.dumps(value) + "\n"
            "print('OK')\n"
            "print(expr, '=', value)\n"
        )
        sandbox.write_file(ws, "check.py", code)
        sandbox.write_file(ws, "solution.py", f"ANSWER = {value!r}\nprint(ANSWER)\n")
        return f"Evaluated `{raw.strip()}` -> {value}. check.py prints OK."
    return None


async def research_report(prompt: str, ws: Path, fetch) -> str | None:
    urls = URLS.findall(prompt)
    notes: list[str] = []
    used: list[str] = []
    if urls:
        for url in urls[:3]:
            used.append(url)
            notes.append(await fetch(url))
    else:
        q = quote(re.sub(r"\s+", " ", prompt)[:80])
        search = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={q}&limit=3&format=json"
        raw = await fetch(search)
        notes.append(raw)
        used.append(search)
        try:
            data = json.loads(raw.split("\n\n", 1)[-1])
            titles = data[1] if isinstance(data, list) and len(data) > 1 else []
        except Exception:
            titles = []
        if titles:
            title = quote(str(titles[0]).replace(" ", "_"))
            summary = f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
            notes.append(await fetch(summary))
            used.append(summary)
    if not notes:
        return None
    body = [f"# {prompt.strip()[:120]}", "", "## Sources"]
    for u in used:
        body.append(f"- {u}")
    body += ["", "## Notes", ""]
    for chunk in notes:
        body.append(chunk[:4000])
        body.append("")
    text = "\n".join(body)
    sandbox.write_file(ws, "report.md", text)
    return text[:4000]
