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
    if low.endswith(".css") and ".hidden" not in body:
        body = body.rstrip() + PLAY_CSS
    if low.endswith((".html", ".htm")):
        body = re.sub(r"<canvas\b[^>]*>", _ensure_canvas_size, body, count=1, flags=re.I)
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
    if len(blob) < 80:
        return False
    if re.search(r"</html>|</style>|^#{1,3} ", blob, re.M | re.I):
        return False
    if re.search(r"<\s*script\b", blob, re.I):
        return False
    if not _code_balanced(blob):
        return False
    if re.search(r"[:,=+\-*/(\[{]\s*$", blob):
        return False
    last = blob.rstrip()[-1]
    if last not in "});":
        return False
    return True


def css_looks_complete(text: str) -> bool:
    blob = strip_model_tail(text or "").strip()
    if len(blob) < 20:
        return False
    if re.search(r"```|</style>|^#{1,3} ", blob, re.M | re.I):
        return False
    if not _code_balanced(blob):
        return False
    return not bool(re.search(r"[{:;,]\s*$", blob))


def _looks_like_game(html: str) -> bool:
    return bool(re.search(r"<canvas\b|gameCanvas|requestAnimationFrame", html or "", re.I))


def _js_hooks_ui(js: str, html: str) -> bool:
    if not _looks_like_game(html):
        return True
    if not re.search(r"addEventListener|onclick\s*=|requestAnimationFrame", js or "", re.I):
        return False
    if re.search(r"id=['\"](?:btn-start|start-btn|play-btn)['\"]", html or "", re.I):
        if not re.search(r"btn-start|start-btn|play-btn|startGame", js or ""):
            return False
    return True


def _site_js_playable(ws: Path, html: str) -> bool:
    files = set(sandbox.list_files(ws))
    linked = [_safe_asset_name(name, "") for name in SCRIPT_SRC.findall(html or "")]
    linked = [name for name in linked if name]
    names = linked or [name for name in files if name.endswith(".js")]
    if not names:
        return False
    for name in names:
        if name not in files:
            return False
        body = sandbox.read_file(ws, name)
        if not js_looks_complete(body) or not _js_hooks_ui(body, html):
            return False
    return True


def fallback_game_js() -> str:
    path = Path(__file__).with_name("play_fallback.js")
    return path.read_text(encoding="utf-8")


def heal_site(ws: Path) -> None:
    """Link an existing script if the page forgot the tag. Never replace the agent's file."""
    files = set(sandbox.list_files(ws))
    htmls = [name for name in files if name.endswith((".html", ".htm"))]
    if not htmls or "script.js" not in files:
        return
    html = sandbox.read_file(ws, htmls[0])
    if SCRIPT_SRC.search(html or "") or SCRIPT_BLOCK.search(html or ""):
        return
    patched = re.sub(
        r"</body>",
        '<script src="script.js"></script>\n</body>',
        html,
        count=1,
        flags=re.I,
    )
    if patched == html:
        patched = html.rstrip() + '\n<script src="script.js"></script>\n'
    sandbox.write_file(ws, htmls[0], patched)


def site_gap(ws: Path) -> str | None:
    """If a page is missing or cut off, ask the model to finish the files."""
    files = sandbox.list_files(ws)
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    if not htmls:
        return None
    html = sandbox.read_file(ws, htmls[0])
    interactive = _looks_like_game(html) or bool(
        re.search(r"addEventListener|onclick=|keydown|game", html, re.I)
    )
    js_files = [f for f in files if f.endswith(".js")]
    has_inline = bool(SCRIPT_BLOCK.search(html))
    linked = [_safe_asset_name(m, "") for m in SCRIPT_SRC.findall(html)]
    linked = [n for n in linked if n]
    if interactive or linked:
        missing = [n for n in linked if n not in files]
        if missing:
            return (
                f"{missing[0]} is linked from the page but missing. "
                "write_file the COMPLETE file now. Keep the game small enough to finish: "
                "2D canvas, wired Start button, .hidden menus. Raw source only, no markdown."
            )
        if not js_files and not has_inline:
            return (
                "This page needs script.js to be interactive. "
                "write_file a COMPLETE working script.js now. Wire every button id from the HTML. "
                "Raw JavaScript only. No markdown."
            )
        for name in js_files or linked:
            if name not in files:
                continue
            body = sandbox.read_file(ws, name)
            tidy = strip_model_tail(body)
            if tidy != body:
                sandbox.write_file(ws, name, tidy)
                body = tidy
            if not js_looks_complete(body) or not _js_hooks_ui(body, html):
                return (
                    f"{name} is incomplete or does not wire the Start button. "
                    "write_file the complete file from the first line to the last closing brace. "
                    "Keep it a finished 2D game, not a huge engine. Raw JavaScript only."
                )
    css_linked = [_safe_asset_name(name, "") for name in LINK_CSS.findall(html)]
    css_linked = [name for name in css_linked if name]
    missing_css = [name for name in css_linked if name not in files]
    if missing_css:
        return (
            f"{missing_css[0]} is linked from the page but missing. "
            "write_file the COMPLETE stylesheet now. Raw CSS only, no markdown."
        )
    css_files = [f for f in files if f.endswith(".css")]
    if (interactive or css_linked) and not css_files and not STYLE_BLOCK.search(html):
        return (
            "This page needs styles.css. write_file the COMPLETE stylesheet now. "
            "Raw CSS only, no markdown."
        )
    for name in css_files:
        body = sandbox.read_file(ws, name)
        tidy = strip_model_tail(body)
        if tidy != body:
            sandbox.write_file(ws, name, tidy)
            body = tidy
        if not css_looks_complete(body):
            return (
                f"{name} was cut off. write_file the complete stylesheet "
                "from the first rule to the last closing brace. Raw CSS only."
            )
    return None


PLAY_CSS = """
.hidden,
.screen.hidden,
.overlay.hidden,
.menu.hidden,
.screen.active.hidden,
.menu.active.hidden,
#start-screen.hidden,
#game-over-screen.hidden,
#pause-screen.hidden,
#menu-start.hidden,
#menu-pause.hidden,
#menu-gameover.hidden {
  display: none !important;
  visibility: hidden !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
.screen:not(.active),
.menu:not(.active):not(.hidden) {
  pointer-events: none;
}
#ui-layer, #hud, .hud-section {
  pointer-events: none !important;
}
#ui-layer button,
.menu, .menu.active, .overlay:not(.hidden), .screen.active,
.action-btn, #start-btn, #restart-btn, #resume-btn,
#btn-start, #btn-retry, #btn-resume, #btn-restart {
  pointer-events: auto !important;
  cursor: pointer !important;
}
canvas { touch-action: none; cursor: crosshair !important; }
"""

PLAY_JS = r"""
(function () {
  function fitCanvas() {
    var c = document.getElementById("gameCanvas") || document.querySelector("canvas");
    if (!c) return;
    var box = (c.parentElement || document.body).getBoundingClientRect();
    var w = Math.max(640, Math.floor(box.width) || 800);
    var h = Math.max(480, Math.floor(box.height) || 600);
    if (!c.getAttribute("width") || c.width < 100) c.width = w;
    if (!c.getAttribute("height") || c.height < 100) c.height = h;
  }
  function hideMenus() {
    document.querySelectorAll(
      ".screen, .overlay, .menu, #start-screen, #game-over-screen, #pause-screen, #menu-start, #menu-pause, #menu-gameover"
    ).forEach(function (el) {
      el.classList.remove("active");
      el.classList.add("hidden");
    });
  }
  function showEl(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.add("active");
  }
  function startFn() {
    return window.startGame || window.init || window.beginGame || window.start;
  }
  function wrap(name, before, after) {
    var fn = window[name];
    if (typeof fn !== "function" || fn.__deskWrapped) return;
    var wrapped = function () {
      if (before) before.apply(this, arguments);
      var result = fn.apply(this, arguments);
      if (after) after.apply(this, arguments);
      return result;
    };
    wrapped.__deskWrapped = true;
    window[name] = wrapped;
  }
  function bindStart(node) {
    if (!node || node.getAttribute("data-desk-bound")) return;
    node.setAttribute("data-desk-bound", "1");
    node.addEventListener("click", function (e) {
      hideMenus();
      var fn = startFn();
      if (typeof fn === "function") {
        fn();
        e.stopImmediatePropagation();
      }
    }, true);
  }
  function boot() {
    fitCanvas();
    wrap("startGame", hideMenus);
    wrap("init", hideMenus);
    wrap("endGame", null, function () {
      showEl(document.getElementById("game-over-screen") || document.getElementById("menu-gameover"));
    });
    [
      "start-btn", "restart-btn", "btn-start", "btn-retry", "btn-restart", "play-btn"
    ].forEach(function (id) {
      bindStart(document.getElementById(id));
    });
    document.querySelectorAll(".action-btn, .menu button, .overlay button, .screen button").forEach(function (btn) {
      var blob = ((btn.id || "") + " " + (btn.textContent || "")).toLowerCase();
      if (/resume/.test(blob)) return;
      if (/start|retry|initialize|play|reboot/.test(blob)) bindStart(btn);
    });
    ["resume-btn", "btn-resume"].forEach(function (id) {
      var b = document.getElementById(id);
      if (!b || b.getAttribute("data-desk-bound")) return;
      b.setAttribute("data-desk-bound", "1");
      b.addEventListener("click", function () {
        var p = document.getElementById("pause-screen") || document.getElementById("menu-pause");
        if (p) {
          p.classList.remove("active");
          p.classList.add("hidden");
        }
        if (typeof window.togglePause === "function") window.togglePause();
      }, true);
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  window.addEventListener("resize", fitCanvas);
})();
"""


def _ensure_canvas_size(match: re.Match[str]) -> str:
    tag = match.group(0)
    if re.search(r"\bwidth\s*=", tag, re.I):
        return tag
    return re.sub(r"\s*/?>$", ' width="800" height="600">', tag, count=1)


def playable_page(ws: Path, html: str, base: str = "") -> str:
    """Make View a real playable document: load local files and fix overlay/click traps."""
    blob = decode_written_text(html or "")
    blob = re.sub(r"<canvas\b[^>]*>", _ensure_canvas_size, blob, count=1, flags=re.I)
    files = set(sandbox.list_files(ws))
    has_js = any(name.endswith(".js") for name in files) or bool(
        SCRIPT_BLOCK.search(blob) or SCRIPT_SRC.search(blob)
    )
    if _looks_like_game(blob) and not has_js:
        game = f"<script id=\"desk-game\">{fallback_game_js()}</script>\n"
        if re.search(r"</body>", blob, re.I):
            blob = re.sub(r"</body>", game + "</body>", blob, count=1, flags=re.I)
        else:
            blob += game
    extras = ""
    if base:
        href = base if base.endswith("/") else base + "/"
        extras += f'<base href="{href}">\n'
    extras += f"<style id=\"desk-play\">{PLAY_CSS}</style>\n"
    if re.search(r"<head[^>]*>", blob, re.I):
        blob = re.sub(r"<head[^>]*>", lambda m: m.group(0) + "\n" + extras, blob, count=1, flags=re.I)
    else:
        blob = extras + blob
    boot = f"<script id=\"desk-play-js\">{PLAY_JS}</script>\n"
    if re.search(r"</body>", blob, re.I):
        blob = re.sub(r"</body>", boot + "</body>", blob, count=1, flags=re.I)
    else:
        blob += boot
    return blob


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
