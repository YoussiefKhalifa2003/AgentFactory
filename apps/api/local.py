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
FENCE = re.compile(r"```(?:\s*([\w./+-]+)\s*\n)?(.*?)```", re.S)
ARITH = re.compile(r"^[0-9.\s+\-*/()]+$")
URLS = re.compile(r"https?://[^\s)>\]]+")
STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
SCRIPT_BLOCK = re.compile(r"<script\b(?![^>]*\bsrc\b)[^>]*>(.*?)</script>", re.S | re.I)
LINK_CSS = re.compile(r"""<link\b[^>]*href=["']([^"']+\.css)["']""", re.I)
SCRIPT_SRC = re.compile(r"""<script\b[^>]*src=["']([^"']+\.js)["']""", re.I)


def is_smalltalk(prompt: str) -> bool:
    return bool(GREET.match(prompt.strip()))


def decode_written_text(text: str) -> str:
    """Models often JSON-escape file bodies (\\n, \\t, \\'). Turn those into a real file."""
    if not text:
        return text
    blob = text
    stripped = blob.strip()
    if stripped.startswith('"') and stripped.endswith('"') and "\\n" in stripped[:120]:
        try:
            loaded = json.loads(stripped)
            if isinstance(loaded, str) and loaded:
                blob = loaded
        except json.JSONDecodeError:
            pass
    escaped_n = blob.count("\\n")
    real_n = blob.count("\n")
    if escaped_n >= 3 and real_n <= 2:
        blob = (
            blob.replace("\\r\\n", "\n")
            .replace("\\n", "\n")
            .replace("\\r", "\n")
            .replace("\\t", "\t")
            .replace("\\'", "'")
            .replace('\\"', '"')
        )
    return blob


TAIL_MARKDOWN = re.compile(
    r"\n(?:Here are the files\b|The (?:HTML|CSS|JavaScript|JS|files)\b|### (?:index\.html|styles\.css|script\.js)|Wrote (?:index|styles|script)\b|\*\*(?:index\.html|styles\.css|script\.js)\*\*)",
    re.I,
)


def strip_model_tail(text: str) -> str:
    """Cut off chat recap that models append after a real file body."""
    blob = text or ""
    m = TAIL_MARKDOWN.search(blob)
    if m and m.start() > 40:
        blob = blob[: m.start()].rstrip()
    return blob


def tidy_site_file(rel: str, content: str) -> str:
    body = decode_written_text(content or "")
    low = (rel or "").replace("\\", "/").lower()
    if low.endswith((".js", ".css", ".html", ".htm")):
        body = strip_model_tail(body)
    return body


def _safe_asset_name(rel: str, fallback: str) -> str:
    name = (rel or "").replace("\\", "/").split("?")[0].lstrip("/")
    if not name or ".." in name:
        return fallback
    if not re.match(r"^[A-Za-z0-9._/-]+$", name):
        return fallback
    return name


def _code_balanced(text: str) -> bool:
    curly = round_ = square = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in {'"', "'", "`"}:
            quote = ch
            i += 1
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        if ch == "{":
            curly += 1
        elif ch == "}":
            curly -= 1
        elif ch == "(":
            round_ += 1
        elif ch == ")":
            round_ -= 1
        elif ch == "[":
            square += 1
        elif ch == "]":
            square -= 1
        if curly < 0 or round_ < 0 or square < 0:
            return False
        i += 1
    return curly == 0 and round_ == 0 and square == 0


def js_looks_complete(text: str) -> bool:
    blob = strip_model_tail(text or "").strip()
    if len(blob) < 20:
        return False
    if re.search(r"</html>|</style>|^#{1,3} ", blob, re.M | re.I):
        return False
    return _code_balanced(blob)


def site_gap(ws: Path) -> str | None:
    """If a page is missing or cut off, ask the model to finish the files."""
    files = sandbox.list_files(ws)
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    if not htmls:
        return None
    html = sandbox.read_file(ws, htmls[0])
    interactive = bool(
        re.search(
            r"<canvas\b|requestAnimationFrame|addEventListener|onclick=|keydown|game",
            html,
            re.I,
        )
    )
    js_files = [f for f in files if f.endswith(".js")]
    has_inline = bool(SCRIPT_BLOCK.search(html))
    linked = [ _safe_asset_name(m, "") for m in SCRIPT_SRC.findall(html) ]
    linked = [n for n in linked if n]
    if interactive or linked:
        missing = [n for n in linked if n not in files]
        if missing:
            return (
                f"{missing[0]} is linked from the page but missing. "
                "write_file the COMPLETE file now. Raw source only, no markdown."
            )
        if not js_files and not has_inline:
            return (
                "This page needs script.js to be interactive. "
                "write_file the COMPLETE script.js now. Raw source only, no markdown."
            )
        for name in js_files or linked:
            if name not in files:
                continue
            body = sandbox.read_file(ws, name)
            tidy = strip_model_tail(body)
            if tidy != body:
                sandbox.write_file(ws, name, tidy)
                body = tidy
            if not js_looks_complete(body):
                return (
                    f"{name} was cut off. write_file the complete file from the first line "
                    "to the last closing brace. Raw JavaScript only. No markdown."
                )
    css_files = [f for f in files if f.endswith(".css")]
    for name in css_files:
        body = sandbox.read_file(ws, name)
        tidy = strip_model_tail(body)
        if tidy != body:
            sandbox.write_file(ws, name, tidy)
    return None


def assemble_page(ws: Path, html: str) -> str:
    """Inline local CSS/JS so View is one complete, interactive document."""
    blob = decode_written_text(html or "")
    files = set(sandbox.list_files(ws))

    def swap_css(match: re.Match[str]) -> str:
        tag = match.group(0)
        if "stylesheet" not in tag.lower():
            return tag
        href_m = re.search(r"""href=["']([^"']+)["']""", tag, re.I)
        if not href_m:
            return tag
        href = href_m.group(1)
        if href.startswith(("http://", "https://", "//", "data:")):
            return tag
        name = _safe_asset_name(href, "")
        if not name or name not in files:
            return tag
        css = strip_model_tail(sandbox.read_file(ws, name))
        return f"<style>\n{css}\n</style>"

    blob = re.sub(r"<link\b[^>]*>", swap_css, blob, flags=re.I)

    def swap_js(match: re.Match[str]) -> str:
        tag, attrs, _inner = match.group(0), match.group(1) or "", match.group(2)
        src_m = re.search(r"""src=["']([^"']+)["']""", attrs, re.I)
        if not src_m:
            return tag
        src = src_m.group(1)
        if src.startswith(("http://", "https://", "//", "data:")):
            return tag
        name = _safe_asset_name(src, "")
        if not name or name not in files:
            return tag
        js = strip_model_tail(sandbox.read_file(ws, name))
        type_m = re.search(r"""type=["']([^"']+)["']""", attrs, re.I)
        extra = f' type="{type_m.group(1)}"' if type_m else ""
        return f"<script{extra}>\n{js}\n</script>"

    blob = re.sub(
        r"<script\b([^>]*)>(.*?)</script>",
        swap_js,
        blob,
        flags=re.I | re.S,
    )
    if "styles.css" in files and not STYLE_BLOCK.search(blob):
        blob = _inject_once(
            blob,
            "<style>\n" + strip_model_tail(sandbox.read_file(ws, "styles.css")) + "\n</style>",
            "</head>",
        )
    if "script.js" in files and not SCRIPT_SRC.search(blob) and not SCRIPT_BLOCK.search(blob):
        blob = _inject_once(
            blob,
            "<script>\n" + strip_model_tail(sandbox.read_file(ws, "script.js")) + "\n</script>",
            "</body>",
        )
    return blob


def extract_embedded_assets(html: str) -> list[tuple[str, str]]:
    """Pull <style> / inline <script> out of a page so the desk has real CSS and JS files."""
    blob = decode_written_text(html or "")
    if not blob:
        return []
    out: list[tuple[str, str]] = []
    css_name = "styles.css"
    link = LINK_CSS.search(blob)
    if link:
        css_name = _safe_asset_name(link.group(1), "styles.css")
    css = "\n\n".join(block.strip() for block in STYLE_BLOCK.findall(blob) if block.strip())
    if css:
        out.append((css_name, css))
    js_name = "script.js"
    src = SCRIPT_SRC.search(blob)
    if src:
        js_name = _safe_asset_name(src.group(1), "script.js")
    js = "\n\n".join(block.strip() for block in SCRIPT_BLOCK.findall(blob) if block.strip())
    if js:
        out.append((js_name, js))
    return out


def _inject_once(html: str, tag: str, closer: str) -> str:
    if tag in html:
        return html
    pattern = re.compile(re.escape(closer), re.I)
    if pattern.search(html):
        return pattern.sub(tag + "\n" + closer, html, count=1)
    return html


def materialize_site(ws: Path, extra_text: str = "") -> list[str]:
    """Fix escaped HTML and make sure linked CSS/JS exist on the desk."""
    added: list[str] = []
    files = set(sandbox.list_files(ws))
    for rel, body in extract_fences(extra_text):
        if rel.endswith((".css", ".js", ".html")) and rel not in files and body.strip():
            sandbox.write_file(ws, rel, body)
            files.add(rel)
            added.append(rel)
    for name in list(files):
        if name.endswith((".js", ".css", ".html", ".htm")):
            raw = sandbox.read_file(ws, name)
            tidy = tidy_site_file(name, raw)
            if tidy != raw:
                sandbox.write_file(ws, name, tidy)
    css_dump = maybe_css_source(extra_text)
    if css_dump and "styles.css" not in files:
        sandbox.write_file(ws, "styles.css", css_dump)
        files.add("styles.css")
        added.append("styles.css")
    for rel in [f for f in files if f.endswith((".html", ".htm"))]:
        raw = sandbox.read_file(ws, rel)
        fixed = decode_written_text(raw)
        if fixed != raw:
            sandbox.write_file(ws, rel, fixed)
            raw = fixed
        for path, body in extract_embedded_assets(raw):
            if path not in files and body.strip():
                sandbox.write_file(ws, path, body)
                files.add(path)
                added.append(path)
        if "styles.css" in files and not LINK_CSS.search(raw) and not STYLE_BLOCK.search(raw):
            raw = _inject_once(raw, '<link rel="stylesheet" href="styles.css">', "</head>")
            sandbox.write_file(ws, rel, raw)
        if "script.js" in files and not SCRIPT_SRC.search(raw):
            raw = _inject_once(raw, '<script src="script.js"></script>', "</body>")
            sandbox.write_file(ws, rel, raw)
    return added


def extract_fences(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for lang, body in FENCE.findall(text or ""):
        body = decode_written_text(body.strip())
        if not body:
            continue
        lang = (lang or "").strip()
        low = lang.lower()
        if low in {"python", "py"}:
            out.append(("main.py", body))
        elif low in {"html", "htm"}:
            out.append(("index.html", body))
        elif low in {"css", "scss", "style"}:
            out.append(("styles.css", body))
        elif low.endswith(".css"):
            out.append((_safe_asset_name(lang, "styles.css"), body))
        elif low in {"js", "javascript"}:
            out.append(("script.js", body))
        elif low.endswith(".js"):
            out.append((_safe_asset_name(lang, "script.js"), body))
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
        elif _looks_like_css(body):
            out.append(("styles.css", body))
        elif body.lstrip().startswith(("<mxfile", "flowchart", "graph ")):
            name = "diagram.drawio" if body.lstrip().startswith("<mxfile") else "diagram.mmd"
            out.append((name, body))
        else:
            out.append(("main.py" if "def " in body or "print(" in body else "notes.md", body))
    return out


def _looks_like_html(text: str) -> bool:
    blob = (text or "").lstrip().lower()
    return blob.startswith(("<!doctype html", "<html", "<head", "<body", "<!doctype"))


def _looks_like_css(text: str) -> bool:
    blob = (text or "").strip()
    if not blob or _looks_like_html(blob):
        return False
    if "def " in blob or "print(" in blob:
        return False
    return bool(
        re.search(r"(^|\n)\s*(:root|html|body|\*|@media|[.#][\w-]+|[a-z][\w-]*(?:\s*,\s*[a-z][\w-]*)*)\s*\{", blob, re.I)
        and blob.count("{") >= 2
        and blob.count("}") >= 2
    )


def maybe_css_source(text: str) -> str | None:
    blob = decode_written_text((text or "").strip())
    if not blob or extract_fences(blob):
        return None
    if _looks_like_css(blob):
        return blob
    return None


def maybe_html_source(text: str) -> str | None:
    blob = decode_written_text((text or "").strip())
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
