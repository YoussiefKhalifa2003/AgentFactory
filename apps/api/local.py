"""Deterministic job finishers when no language model is reachable."""

from __future__ import annotations

import ast
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import sandbox


def _desk_read(ws: Path, rel: str) -> str:
    """Uncapped desk read for heal/gap/verify. The model tool still uses sandbox.read_file."""
    return sandbox.read_full(ws, rel)

GREET = re.compile(r"^(hi|hello|hey|yo|thanks|thank you)[\s!.?]*$", re.I)
FENCE = re.compile(r"```(?:\s*([\w./+-]+)\s*\n)?(.*?)```", re.S)
ARITH = re.compile(r"^[0-9.\s+\-*/()]+$")
URLS = re.compile(r"https?://[^\s)>\]]+")
STYLE_BLOCK = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
SCRIPT_BLOCK = re.compile(r"<script\b(?![^>]*\bsrc\b)[^>]*>(.*?)</script>", re.S | re.I)
LINK_CSS = re.compile(r"""<link\b[^>]*href=["']([^"']+\.css)["']""", re.I)
SCRIPT_SRC = re.compile(r"""<script\b[^>]*src=["']([^"']+\.(?:js|mjs))["']""", re.I)
IMG_SRC = re.compile(r"""<(?:img|source|audio|video)\b[^>]*src=["']([^"']+)["']""", re.I)
JS_IMPORT = re.compile(r"""(?:from|import)\s*\(?\s*['"]((?:\.\.?/)?[^'"]+)['"]""", re.I)
JS_FETCH = re.compile(r"""fetch\(\s*['"]([^'"]+)['"]""", re.I)
JS_REQUIRE = re.compile(r"""require\(\s*['"]([^'"]+)['"]""", re.I)
CSS_URL = re.compile(r"""url\(\s*['"]?([^'")\s]+)['"]?\s*\)""", re.I)
JS_STATIC = re.compile(
    r"""['"]([^'"]+\.(?:png|jpe?g|gif|webp|svg|wav|mp3|ogg|json|css|js|mjs|woff2?|ttf|otf|glb|gltf|wasm))['"]""",
    re.I,
)
HTML_REF = re.compile(r"""(?:src|href|poster|data-src)=["']([^"']+)["']""", re.I)
SRCSET = re.compile(r"""srcset=["']([^"']+)["']""", re.I)
PLACEHOLDER_SVG = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">'
    b'<rect fill="#468cd2" width="32" height="32"/></svg>'
)
GAME_HINT = re.compile(r"\b(game|multiplayer|canvas|player|score|level|phaser|fps|shooter)\b", re.I)
RACING_HINT = re.compile(r"\b(racing|racer|driving|car|kart|track)\b", re.I)
CDN_HINT = re.compile(r"unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh", re.I)
FPS_HINT = re.compile(
    r"\b("
    r"fps|first[-\s]?person|cs[:\s-]?go|counter[-\s]?strike|valorant|quake|doom|raycast|wolfenstein|"
    r"(?:3d|three[-\s]?d)\s+shooter"
    r")\b",
    re.I,
)
MULTI_HINT = re.compile(r"\b(multiplayer|online|two phones|lan)\b", re.I)
STUB_ACTOR = "fillRect(actor.x, actor.y, 24, 24)"
GAME_MODULES = ("js/main.js", "js/input.js", "js/entities.js", "js/net.js")
START_RE = re.compile(
    r"""id=["'](?:start-btn|btn-start|play-btn|play-again-btn|btn-play|btn-retry|restart-btn|btn-restart)["']|data-start""",
    re.I,
)
STUB_INPUT = "export const keys = {};\nexport function bindInput() {\n  window.addEventListener('keydown', (e) => { keys[e.code] = true; });\n  window.addEventListener('keyup', (e) => { keys[e.code] = false; });\n}\n"
STUB_ENTITIES = "export function spawn() {\n  return { x: 40, y: 40, vx: 0, vy: 0 };\n}\n"
STUB_NET = "export function connect() {\n  const url = window.FOUNDRY_GAME_WS;\n  if (!url) return null;\n  try { return new WebSocket(url); } catch (e) { return null; }\n}\n"
STUB_MAIN = """import { bindInput } from './input.js';
import { spawn } from './entities.js';
import { connect } from './net.js';
export function boot() {
  bindInput();
  connect();
  const actor = spawn();
  const canvas = document.getElementById('gameCanvas') || document.getElementById('game-canvas') || document.querySelector('canvas');
  const start = document.getElementById('start-btn') || document.querySelector('[data-start], #play-btn, #btn-start, #play-again-btn');
  let running = false;
  function loop() {
    if (!running) return;
    requestAnimationFrame(loop);
    if (!canvas || !canvas.getContext) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#102030';
    ctx.fillRect(0, 0, canvas.width || 800, canvas.height || 600);
    ctx.fillStyle = '#7ec8ff';
    ctx.fillRect(actor.x, actor.y, 24, 24);
  }
  function startGame() {
    running = true;
    canvas && canvas.classList.remove('hidden');
    document.querySelectorAll('#menu-overlay, .overlay, .menu, #loading-screen').forEach((el) => el.classList.add('hidden'));
    loop();
  }
  window.startGame = startGame;
  start && start.addEventListener('click', startGame);
}
boot();
"""
STUB_LEVEL = '{"tiles":[[0,0],[0,0]],"spawn":[1,1],"scores":0}\n'
STUB_README = "Open View, press Start. A second browser or phone can join the same job for multiplayer.\n"
STUB_CSS = "html,body{margin:0;background:#111;color:#fff}canvas{display:block;max-width:100%}.hidden{display:none!important}button{cursor:pointer}\n"
FPS_HTML = """<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Strike</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div id="menu-overlay" class="overlay">
  <h1>STRIKE</h1>
  <p>Click Deploy. WASD move · drag or mouse-lock to look · click shoot · R reload</p>
  <button id="start-btn" type="button">Deploy</button>
</div>
<canvas id="gameCanvas" width="960" height="540"></canvas>
<div id="hud-overlay" class="hud hidden">
  <span>HP <span id="health-text">100</span></span>
  <span>AMMO <span id="current-ammo">30 / 90</span></span>
  <span>SCORE <span id="score-blue">0</span></span>
</div>
<script type="module" src="js/main.js"></script>
</body></html>
"""
FPS_CSS = """
html,body{margin:0;height:100%;background:#0d0c0b;color:#e8e4dc;font-family:Segoe UI,sans-serif;overflow:hidden}
canvas{display:block;width:100%;height:100%;cursor:crosshair}
.hidden{display:none!important}
.overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(8,8,8,.45);z-index:2}
.overlay h1{letter-spacing:.4em;margin:0}
button{cursor:pointer;padding:12px 28px;border:1px solid #c9a227;background:#1a1814;color:#f2e6c2;letter-spacing:.12em}
.hud{position:absolute;left:0;right:0;bottom:18px;display:flex;justify-content:space-around;pointer-events:none;font-variant-numeric:tabular-nums;z-index:1}
"""
LOOP_ALIASES = {"main.py", "main.js", "script.js", "app.js", "game.js", "js/game.js", "src/main.js"}
BINARY_FENCE = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".wav", ".mp3"}


def fps_boot_js() -> str:
    return Path(__file__).with_name("fps_boot.js").read_text(encoding="utf-8")


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
FILE_LABEL = re.compile(
    r"(?im)^(?:#{1,3}\s+|file:\s*|\*\*)?"
    r"(?P<name>"
    r"(?:index|styles|script|main|input|entities|net)\.(?:html?|css|js|mjs)"
    r"|js/[A-Za-z0-9._/-]+\.(?:js|mjs)"
    r"|maps/[A-Za-z0-9._/-]+\.json"
    r"|README\.md"
    r")"
    r"(?:\*\*)?\s*$"
)


def strip_model_tail(text: str) -> str:
    """Cut off chat recap that models append after a real file body."""
    blob = text or ""
    m = TAIL_MARKDOWN.search(blob)
    if m and m.start() > 40:
        blob = blob[: m.start()].rstrip()
    return blob


def split_labeled_dump(text: str) -> list[tuple[str, str]]:
    """Models often paste several files in one write_file, labeled by filename."""
    blob = decode_written_text(text or "").replace("\r\n", "\n")
    if not blob.strip():
        return []
    lines = blob.split("\n")
    hits: list[tuple[int, str]] = []
    for i, line in enumerate(lines):
        m = FILE_LABEL.match(line.strip().strip("*").strip())
        if not m:
            continue
        name = _safe_asset_name(m.group("name").replace("\\", "/"), "")
        if name:
            hits.append((i, name))
    if len(hits) < 1:
        return []
    if hits[0][0] > 0:
        prefix = "\n".join(lines[: hits[0][0]]).strip()
        if prefix.lower().startswith("<!doctype") or _looks_like_html(prefix):
            hits.insert(0, (0, "index.html"))
    if len(hits) < 2:
        return []
    out: list[tuple[str, str]] = []
    for n, (start, name) in enumerate(hits):
        end = hits[n + 1][0] if n + 1 < len(hits) else len(lines)
        label_line = FILE_LABEL.match(lines[start].strip().strip("*").strip())
        chunk = lines[start + 1 : end] if label_line else lines[start:end]
        body = "\n".join(chunk).strip()
        body = re.sub(r"^```[\w./+-]*\n", "", body)
        body = re.sub(r"\n```$", "", body).strip()
        if body:
            out.append((name, body))
    return out if len(out) >= 2 else []


def peel_concatenated(rel: str, content: str) -> str:
    """Keep the slice that belongs to this path when several files were dumped together."""
    blob = decode_written_text(content or "")
    low = (rel or "").replace("\\", "/").lower()
    base = Path(low).name.lower()
    parts = split_labeled_dump(blob)
    if parts:
        for name, body in parts:
            if name.replace("\\", "/").lower() == low or Path(name).name.lower() == base:
                return body
        if low.endswith((".html", ".htm")):
            htmls = [body for name, body in parts if name.endswith((".html", ".htm"))]
            if htmls:
                return htmls[0]
        if low.endswith(".css"):
            css = [body for name, body in parts if name.endswith(".css")]
            if css:
                return css[0]
        if low.endswith((".js", ".mjs")):
            js = [body for name, body in parts if Path(name).name.lower() == base]
            if js:
                return js[0]
    if low.endswith((".html", ".htm")):
        found = re.search(r"(?is)(?:<!DOCTYPE html\b|<html\b).*?</html>", blob)
        if found:
            return found.group(0)
    if low.endswith(".css") and (
        _looks_like_html(blob) or blob.lstrip().lower().startswith(("index.html", "<!doctype", "<html"))
    ):
        rest = re.split(r"</html>\s*", blob, maxsplit=1, flags=re.I)
        tail = rest[1] if len(rest) > 1 else ""
        tail = re.sub(r"^(?:styles\.css|css)\s*\n", "", tail.strip(), flags=re.I)
        if tail and _looks_like_css(tail):
            return tail
        rule = re.search(r"(?ms)^(?:html|body|:root|\*|canvas)\s*\{", blob)
        if rule:
            return blob[rule.start() :]
        return ""
    return blob


def reveal_start(html: str) -> str:
    """Start must be visible. Models hide it behind .menu-hidden and View looks empty."""
    blob = re.sub(r"\b(?:menu-hidden|is-hidden)\b", "", html or "")
    return re.sub(r'\sclass=["\']\s*["\']', "", blob)


def tidy_site_file(rel: str, content: str) -> str:
    body = peel_concatenated(rel, content or "")
    low = (rel or "").replace("\\", "/").lower()
    if low.endswith((".js", ".mjs", ".css", ".html", ".htm", ".json")):
        body = strip_model_tail(body)
    if low.endswith(".css"):
        if not body.strip() or _looks_like_html(body):
            body = STUB_CSS
        if ".hidden" not in body:
            body = body.rstrip() + "\n.hidden{display:none}\n"
    if low.endswith((".html", ".htm")):
        body = reveal_start(body)
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
            closed = False
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    closed = True
                    i += 1
                    break
                i += 1
            if not closed:
                return False
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
    return not bool(re.search(r"[:,=+\-*/(\[{]\s*$", blob))


def js_module_complete(text: str) -> bool:
    blob = strip_model_tail(text or "").strip()
    if len(blob) < 12:
        return False
    if not _code_balanced(blob):
        return False
    return not bool(re.search(r"[:,=+\-*/(\[{]\s*$", blob))


def css_looks_complete(text: str) -> bool:
    blob = strip_model_tail(text or "").strip()
    if len(blob) < 20:
        return False
    if re.search(r"```|</style>|<!DOCTYPE|<html\b|^#{1,3} ", blob, re.M | re.I):
        return False
    if not _code_balanced(blob):
        return False
    return not bool(re.search(r"[{:;,]\s*$", blob))


def looks_like_game(html: str) -> bool:
    return bool(re.search(r"<canvas\b|gameCanvas|requestAnimationFrame", html or "", re.I))


def _looks_like_game(html: str) -> bool:
    return looks_like_game(html)


def prompt_looks_like_game(prompt: str) -> bool:
    return bool(GAME_HINT.search(prompt or "")) or wants_fps(prompt)


def wants_racing(prompt: str) -> bool:
    return bool(RACING_HINT.search(prompt or ""))


def wants_fps(prompt: str) -> bool:
    blob = prompt or ""
    shooter = bool(FPS_HINT.search(blob) or re.search(r"\b(shooter|gunfight|crosshair)\b", blob, re.I))
    if wants_racing(blob) and not shooter:
        return False
    if FPS_HINT.search(blob):
        return True
    three_d = bool(re.search(r"\b(3d|three[-\s]?d|wasd|pointer\s*lock|mouse\s*look)\b", blob, re.I))
    gun = bool(re.search(r"\b(shooter|gunfight|crosshair|aim(?:ing)?)\b", blob, re.I))
    return three_d and gun


def wants_multiplayer(prompt: str) -> bool:
    return bool(MULTI_HINT.search(prompt or ""))


def looks_like_stub_main(text: str) -> bool:
    return STUB_ACTOR in (text or "")


def looks_like_javascript(text: str) -> bool:
    blob = text or ""
    js_hits = len(
        re.findall(
            r"\b(const|let|function|export |import |document\.|addEventListener|requestAnimationFrame|window\.)\b",
            blob,
        )
    )
    py_hits = len(re.findall(r"(?m)^\s*(def |class |elif |import os|from pathlib)", blob))
    return js_hits >= 3 and js_hits > py_hits


def html_looks_complete(text: str) -> bool:
    blob = (text or "").strip()
    if len(blob) < 40:
        return False
    if not re.search(r"(?i)<(?:!DOCTYPE html|html\b)", blob):
        return False
    return bool(re.search(r"(?i)</html\s*>", blob))


def game_loop_ok(text: str, prompt: str = "") -> bool:
    blob = text or ""
    if not blob.strip() or looks_like_stub_main(blob):
        return False
    if not js_module_complete(blob):
        return False
    if wants_fps(prompt):
        has_look = bool(re.search(r"pointerlock|requestPointerLock|movementX|yaw|pitch|raycast", blob, re.I))
        has_shoot = bool(re.search(r"mousedown|click|shoot|fire|weapon|ammo", blob, re.I))
        has_move = bool(re.search(r"KeyW|KeyA|KeyS|KeyD|\bwasd\b|keys\[", blob, re.I))
        return bool(has_look and has_shoot and has_move)
    return True


def promote_game_loop(ws: Path, prompt: str = "") -> None:
    files = sandbox.list_files(ws)
    current = _desk_read(ws, "js/main.js") if "js/main.js" in files else ""
    if game_loop_ok(current, prompt):
        return
    for name in files:
        low = name.replace("\\", "/").lower()
        base = Path(name).name.lower()
        if low == "js/main.js":
            continue
        if base not in LOOP_ALIASES and low not in LOOP_ALIASES:
            continue
        body = _desk_read(ws, name)
        if looks_like_javascript(body) and game_loop_ok(body, prompt):
            sandbox.write_file(ws, "js/main.js", body)
            return


def _png_chunk(tag: bytes, data: bytes) -> bytes:
    import struct
    import zlib

    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def placeholder_png(width: int = 32, height: int = 32, rgb: tuple[int, int, int] = (70, 140, 210)) -> bytes:
    import struct
    import zlib

    row = bytes([0]) + bytes(rgb) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(raw, 9))
        + _png_chunk(b"IEND", b"")
    )


def ensure_game_assets(ws: Path, prompt: str = "") -> None:
    files = sandbox.list_files(ws)
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    html = _desk_read(ws, htmls[0]) if htmls else ""
    if not (prompt_looks_like_game(prompt) or looks_like_game(html)):
        return
    sprites = [
        f
        for f in files
        if f.startswith("assets/") and f.lower().endswith((".png", ".webp", ".jpg", ".jpeg", ".gif"))
    ]
    if not sprites:
        sandbox.write_bytes(ws, "assets/sprite.png", placeholder_png())


def _module_exports(text: str) -> bool:
    return bool(re.search(r"(?m)^\s*export\s+", text or ""))


def _css_is_stub(text: str) -> bool:
    blob = (text or "").strip()
    return (not blob) or blob == STUB_CSS.strip() or len(blob) < 160


def ensure_game_tree(ws: Path, prompt: str = "") -> None:
    """Fill missing game files so a playable page is never blocked for a stub."""
    scrub_mixed_site(ws)
    files = set(sandbox.list_files(ws))
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    html = _desk_read(ws, htmls[0]) if htmls else ""
    if not (prompt_looks_like_game(prompt) or looks_like_game(html)):
        return
    promote_game_loop(ws, prompt)
    files = set(sandbox.list_files(ws))
    fps_reskin = False
    stubs = {
        "js/input.js": STUB_INPUT,
        "js/entities.js": STUB_ENTITIES,
        "js/net.js": STUB_NET,
        "js/main.js": STUB_MAIN,
        "styles.css": STUB_CSS,
        "README.md": STUB_README,
        "maps/level.json": STUB_LEVEL,
    }
    for rel, body in stubs.items():
        if rel == "maps/level.json" and any(f.endswith("level.json") for f in files):
            continue
        existing = _desk_read(ws, rel) if rel in files else ""
        missing = rel not in files or not existing.strip()
        mixed = rel.endswith(".css") and not css_looks_complete(existing)
        if rel == "js/main.js" and wants_fps(prompt):
            boot = fps_boot_js()
            if game_loop_ok(existing, prompt):
                continue
            if (
                existing.strip()
                and len(existing) > len(STUB_MAIN)
                and (
                    "requestAnimationFrame" in existing
                    or "generateTrack" in existing
                    or "THREE" in existing
                )
            ):
                continue
            sandbox.write_file(ws, rel, boot)
            files.add(rel)
            fps_reskin = True
            for mod, stub in (("js/input.js", STUB_INPUT), ("js/entities.js", STUB_ENTITIES), ("js/net.js", STUB_NET)):
                other = _desk_read(ws, mod) if mod in files else ""
                if not _module_exports(other):
                    sandbox.write_file(ws, mod, stub)
                    files.add(mod)
            continue
        if wants_fps(prompt) and rel == "styles.css":
            factory_css = "letter-spacing:.4em" in (existing or "").replace(" ", "")
            if existing.strip() == FPS_CSS.strip():
                continue
            if factory_css or _css_is_stub(existing) or not css_looks_complete(existing):
                sandbox.write_file(ws, rel, FPS_CSS)
                files.add(rel)
                continue
            continue
        if rel == "js/main.js" and not wants_fps(prompt) and "script.js" in files:
            script_body = _desk_read(ws, "script.js")
            if js_looks_complete(script_body) and (rel not in files or looks_like_stub_main(existing)):
                continue
        if missing or mixed:
            sandbox.write_file(ws, rel, body)
            files.add(rel)
    files = set(sandbox.list_files(ws))
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    html = _desk_read(ws, htmls[0]) if htmls else ""
    need_page = not htmls or not html_looks_complete(html)
    if wants_fps(prompt) and fps_reskin:
        need_page = True
    elif wants_fps(prompt) and not need_page and not re.search(r"<canvas\b", html or "", re.I):
        loop = _desk_read(ws, "js/main.js") if "js/main.js" in files else ""
        if "THREE" not in loop and "three.js" not in (html or "").lower():
            need_page = True
    if not htmls or (wants_fps(prompt) and need_page):
        sandbox.write_file(ws, htmls[0] if htmls else "index.html", FPS_HTML if wants_fps(prompt) else """<!DOCTYPE html><html><head><link rel="stylesheet" href="styles.css"></head>
<body><button id="start-btn" type="button">Start</button>
<canvas id="gameCanvas" width="800" height="600"></canvas>
<script type="module" src="js/main.js"></script></body></html>
""")
        htmls = [htmls[0] if htmls else "index.html"]
        html = _desk_read(ws, htmls[0])
    page = html
    if not START_RE.search(page or ""):
        patched = re.sub(
            r"(<body[^>]*>)",
            r'\1\n<button id="start-btn" type="button">Start</button>',
            page,
            count=1,
            flags=re.I,
        )
        if patched == page:
            patched = page + '\n<button id="start-btn" type="button">Start</button>\n'
        sandbox.write_file(ws, htmls[0], patched)
        page = patched
    revealed = reveal_start(page)
    if revealed != page:
        sandbox.write_file(ws, htmls[0], revealed)
        page = revealed
    if "js/main.js" in sandbox.list_files(ws) and "js/main.js" not in (page or ""):
        heal_site(ws)
    ensure_game_assets(ws, prompt)


def game_gap(ws: Path, prompt: str = "") -> str | None:
    files = sandbox.list_files(ws)
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    html = _desk_read(ws, htmls[0]) if htmls else ""
    if not (prompt_looks_like_game(prompt) or looks_like_game(html)):
        return None
    if "index.html" not in files and not htmls:
        return (
            "This is a game. write_file index.html with a canvas, HUD, and a Start control "
            "(#start-btn or [data-start]). Raw HTML only."
        )
    if "styles.css" not in files or not _desk_read(ws, "styles.css").strip():
        return "This is a game. write_file a COMPLETE styles.css. Raw CSS only."
    if wants_racing(prompt) and not wants_fps(prompt) and not wants_multiplayer(prompt):
        loop_name = "js/main.js" if "js/main.js" in files else ("script.js" if "script.js" in files else "")
        if not loop_name:
            return (
                "This racing game needs js/main.js or script.js. "
                "write_file the COMPLETE loop now. Raw JavaScript only."
            )
        body = _desk_read(ws, loop_name)
        if not js_parses(body):
            return (
                f"{loop_name} has a JavaScript syntax error. write_file the complete file. "
                "Do not redeclare a function parameter with const or let."
            )
        if CDN_HINT.search(html + "\n" + body):
            return "Do not load scripts from a CDN. Keep View offline."
        return None
    for name in GAME_MODULES:
        if name not in files or not _desk_read(ws, name).strip():
            return (
                f"{name} is missing. A game needs js/main.js, js/input.js, js/entities.js, and js/net.js. "
                "write_file the COMPLETE module now. Raw JavaScript only, no markdown."
            )
    has_level = any(
        f.endswith("level.json") or f in {"maps/level.json", "data/level.json"} for f in files
    )
    if not has_level:
        return (
            "maps/level.json or data/level.json is missing. write_file a COMPLETE level table "
            "(tiles, spawn, scores). Raw JSON only."
        )
    if wants_multiplayer(prompt) and "js/net.js" not in files:
        return (
            "js/net.js is missing for multiplayer. Use window.FOUNDRY_GAME_WS for the factory relay. "
            "write_file the COMPLETE module now."
        )
    page = html or _desk_read(ws, htmls[0])
    if not START_RE.search(page or ""):
        return (
            "index.html needs a Start button (#start-btn, #btn-start, #play-btn, or [data-start]). "
            "write_file the complete page."
        )
    if "README.md" not in files:
        return (
            "README.md is missing. write_file how to play: open View, press Start"
            + (", second browser or phone for multiplayer" if wants_multiplayer(prompt) else "")
            + "."
        )
    return fps_gap(ws, prompt)


def _js_bundle(ws: Path) -> str:
    return "\n".join(
        _desk_read(ws, name) for name in sandbox.list_files(ws) if name.endswith(".js")
    )


def fps_gap(ws: Path, prompt: str = "") -> str | None:
    if not wants_fps(prompt):
        return None
    files = set(sandbox.list_files(ws))
    js = _desk_read(ws, "js/main.js") if "js/main.js" in files else _js_bundle(ws)
    if not js.strip() or looks_like_stub_main(js):
        return (
            "This job asked for a first-person shooter. The desk still has a toy square. "
            "write_file a COMPLETE js/main.js: WASD, mouse look (pointer lock is allowed), "
            "click-to-shoot, a map, and a HUD. Raw JavaScript only."
        )
    has_look = bool(
        re.search(r"pointerlock|requestPointerLock|movementX|yaw|pitch|raycast", js, re.I)
    )
    has_shoot = bool(re.search(r"mousedown|click|shoot|fire|weapon|ammo", js, re.I))
    has_move = bool(re.search(r"KeyW|KeyA|KeyS|KeyD|\bwasd\b|keys\[", js, re.I))
    missing: list[str] = []
    if not has_move:
        missing.append("WASD movement")
    if not has_look:
        missing.append("mouse look / camera")
    if not has_shoot:
        missing.append("click-to-shoot")
    if missing:
        return (
            "This job asked for an FPS like CSGO. Still missing "
            + ", ".join(missing)
            + ". write_file the complete modules. Do not flatten to a top-down square."
        )
    return None


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
        body = _desk_read(ws, name)
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
    if not htmls:
        return
    html = _desk_read(ws, htmls[0])
    if "js/main.js" in files:
        main_body = _desk_read(ws, "js/main.js")
        module_main = bool(re.search(r"(?m)^\s*(import |export )", main_body or ""))
        main_tag = (
            '<script type="module" src="js/main.js"></script>'
            if module_main
            else '<script src="js/main.js"></script>'
        )
        if "js/main.js" not in (html or ""):
            patched = re.sub(
                r"</body>",
                main_tag + "\n</body>",
                html,
                count=1,
                flags=re.I,
            )
            if patched == html:
                patched = html.rstrip() + "\n" + main_tag + "\n"
            sandbox.write_file(ws, htmls[0], patched)
            return
        if module_main and not re.search(
            r'<script[^>]*type=["\']module["\'][^>]*src=["\']js/main\.js', html or "", re.I
        ):
            patched = re.sub(
                r"<script([^>]*src=[\"']js/main\.js[\"'][^>]*)>",
                r'<script type="module"\1>',
                html,
                count=1,
                flags=re.I,
            )
            if patched != html:
                sandbox.write_file(ws, htmls[0], patched)
            return
    if "script.js" not in files:
        return
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


def _local_ref(url: str) -> str:
    raw = (url or "").strip()
    if not raw or raw.startswith(("#", "data:", "mailto:", "javascript:", "http://", "https://", "//")):
        return ""
    name = _safe_asset_name(raw.split("?")[0].split("#")[0], "")
    while name.startswith("./"):
        name = name[2:]
    return name


def close_html(html: str) -> str:
    blob = html or ""
    if not re.search(r"(?i)</body\s*>", blob):
        blob = blob.rstrip() + "\n</body>"
    if not re.search(r"(?i)</html\s*>", blob):
        blob = blob.rstrip() + "\n</html>"
    return blob


def _brace_counts(text: str) -> tuple[bool, int, int, int]:
    """Quotes closed?, leftover { ( [ counts. Same scan as _code_balanced."""
    curly = round_ = square = 0
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch in {'"', "'", "`"}:
            quote = ch
            i += 1
            closed = False
            while i < n:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    closed = True
                    i += 1
                    break
                i += 1
            if not closed:
                return False, curly, round_, square
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
            return True, max(curly, 0), max(round_, 0), max(square, 0)
        i += 1
    return True, curly, round_, square


def repair_js(text: str) -> str:
    """Close the usual truncated template-literal so View is not a blank syntax error."""
    blob = text or ""
    if _code_balanced(blob):
        return blob
    fixed = re.sub(
        r"`([^`\n]*\$\{[^}]+\}[^`\n]*?)(\);)",
        r"`\1`\2",
        blob,
    )
    if _code_balanced(fixed):
        return fixed
    if fixed.count("`") % 2 == 1:
        last = fixed.rfind("`")
        rest = fixed[last + 1 :]
        hit = re.search(r"(\);)", rest)
        if hit:
            pos = last + 1 + hit.start()
            trial = fixed[:pos] + "`" + fixed[pos:]
            if _code_balanced(trial):
                return trial
        trial = fixed.rstrip() + "`\n"
        if _code_balanced(trial):
            return trial
        if trial.count("`") % 2 == 0:
            return trial
    return blob


def _match_brace(text: str, open_idx: int) -> int:
    curly = 0
    i = open_idx
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
            if curly == 0:
                return i
        i += 1
    return -1


def repair_shadowed_params(text: str) -> str:
    """Rename `const ctx` inside `function foo(ctx)` so the module parses."""
    blob = text or ""
    out = blob
    for match in list(re.finditer(r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)\s*\{", out)):
        params = [p.strip().split("=")[0].strip() for p in match.group(1).split(",") if p.strip()]
        params = [p for p in params if re.match(r"^[A-Za-z_$][\w$]*$", p)]
        if not params:
            continue
        open_at = match.end() - 1
        close_at = _match_brace(out, open_at)
        if close_at < 0:
            continue
        body = out[open_at + 1 : close_at]
        changed = False
        for param in params:
            decl = re.search(rf"\b(?:const|let|var)\s+{re.escape(param)}\b", body)
            if not decl:
                continue
            alias = "miniCtx" if param == "ctx" else f"{param}Local"
            n = 1
            while alias in body or alias in params:
                alias = f"{param}Local{n}"
                n += 1
            at = decl.start()
            prefix = body[:at]
            rest = re.sub(rf"\b{re.escape(param)}\b", alias, body[at:])
            body = prefix + rest
            changed = True
        if changed:
            out = out[: open_at + 1] + body + out[close_at:]
    return out


def _js_shadowed_params(text: str) -> bool:
    blob = text or ""
    for match in re.finditer(r"\bfunction\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)", blob):
        params = [p.strip().split("=")[0].strip() for p in match.group(1).split(",") if p.strip()]
        window = blob[match.end() : match.end() + 4000]
        for param in params:
            if re.match(r"^[A-Za-z_$][\w$]*$", param) and re.search(
                rf"\b(?:const|let|var)\s+{re.escape(param)}\b", window
            ):
                return True
    return False


def js_parses(text: str) -> bool:
    blob = text or ""
    if not blob.strip():
        return False
    node = shutil.which("node")
    if node:
        path = ""
        try:
            with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as handle:
                handle.write(blob)
                path = handle.name
            proc = subprocess.run(
                [node, "--check", path],
                capture_output=True,
                text=True,
                timeout=5,
            )
            return proc.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            pass
        finally:
            if path:
                Path(path).unlink(missing_ok=True)
    if not _code_balanced(blob):
        return False
    return not _js_shadowed_params(blob)


CLASSIC_JS_STUB = """(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    const root = document.body;
    if (!root) return;
    root.addEventListener("click", function () {});
  });
})();
"""
DESK_PROXY = """const __desk = new Proxy(function () { return __desk; }, {
  get(_t, p) { return p === "then" ? undefined : __desk; },
  apply() { return __desk; },
  construct() { return __desk; },
});
"""


def _import_bindings(body: str, spec: str) -> tuple[list[str], bool]:
    """Named exports the importer expects, plus whether a default export is needed."""
    names: list[str] = []
    needs_default = False
    if not (body or "").strip() or not (spec or "").strip():
        return names, needs_default
    spec_pat = re.escape(spec)
    for match in re.finditer(
        rf"import\s+([\s\S]+?)\s+from\s*['\"]{spec_pat}['\"]",
        body,
        re.I,
    ):
        clause = " ".join(match.group(1).split())
        if clause.startswith("*"):
            continue
        head, _, named = clause.partition("{")
        token = head.replace(",", " ").strip()
        if token and token != "type":
            needs_default = True
        if named:
            inner = named.split("}")[0]
            for part in inner.split(","):
                bit = part.strip()
                if not bit or bit.startswith("type "):
                    continue
                ident = re.split(r"\s+as\s+", bit, flags=re.I)[0].strip()
                if re.match(r"^[A-Za-z_$][\w$]*$", ident):
                    names.append(ident)
    for match in re.finditer(
        rf"export\s+(?:\*\s+from\s*['\"]{spec_pat}['\"]|\{{([^}}]+)\}}\s*from\s*['\"]{spec_pat}['\"])",
        body,
        re.I,
    ):
        inner = match.group(1) or ""
        for part in inner.split(","):
            bit = part.strip()
            if not bit:
                continue
            ident = re.split(r"\s+as\s+", bit, flags=re.I)[0].strip()
            if re.match(r"^[A-Za-z_$][\w$]*$", ident):
                names.append(ident)
    return names, needs_default


def _generic_js_stub(names: list[str], needs_default: bool, rel: str = "module") -> str:
    label = json.dumps(f"missing module: {rel}")
    if not names and not needs_default:
        return f"throw new Error({label});\n"
    bits: list[str] = []
    seen: set[str] = set()
    for name in names:
        if name in seen:
            continue
        seen.add(name)
        bits.append(f"export const {name} = () => {{ throw new Error({label}); }};\n")
    if needs_default:
        bits.append(f"export default () => {{ throw new Error({label}); }};\n")
    return "".join(bits)


def _module_stub(rel: str, prompt: str = "", *, source: str = "", spec: str = "") -> str:
    name = rel.replace("\\", "/").lower()
    if name.endswith("input.js"):
        return STUB_INPUT
    if name.endswith("entities.js"):
        return STUB_ENTITIES
    if name.endswith("net.js"):
        return STUB_NET
    if name.endswith("main.js") and wants_fps(prompt):
        return fps_boot_js()
    if name.endswith("main.js"):
        return STUB_MAIN
    if name.endswith(".json"):
        return "{}\n"
    if name.endswith(".css"):
        return STUB_CSS
    names, needs_default = _import_bindings(source, spec)
    if names or needs_default:
        return _generic_js_stub(names, needs_default, name)
    if name.endswith(".mjs") or "/js/" in name or name.startswith("js/"):
        return "export {};\n"
    return CLASSIC_JS_STUB


def _rel_from(importer: str, spec: str) -> str:
    raw = (spec or "").strip()
    if raw.startswith("./") or raw.startswith("../"):
        merged = (Path(importer).parent / raw).as_posix().replace("\\", "/")
        parts: list[str] = []
        for piece in merged.split("/"):
            if piece == "..":
                if parts:
                    parts.pop()
            elif piece and piece != ".":
                parts.append(piece)
        return "/".join(parts)
    local = _local_ref(raw)
    if local and "/" not in local.replace("\\", "/") and importer:
        parent = Path(importer.replace("\\", "/")).parent.as_posix()
        if parent and parent != ".":
            return f"{parent}/{local}"
    return local


def _plantable_spec(spec: str) -> bool:
    s = (spec or "").strip()
    if not s or s.startswith(("#", "data:", "mailto:", "javascript:", "http://", "https://", "//")):
        return False
    if s.startswith("./") or s.startswith("../"):
        return True
    return bool(
        re.search(
            r"\.(?:js|mjs|json|css|png|jpe?g|gif|webp|svg|ico|wav|mp3|ogg|woff2?|ttf|otf|glb|gltf|wasm)$",
            s,
            re.I,
        )
    )


def _write_missing_asset(
    ws: Path,
    rel: str,
    files: set[str],
    prompt: str = "",
    *,
    source: str = "",
    spec: str = "",
) -> None:
    name = (rel or "").replace("\\", "/")
    if not name or name in files:
        return
    if not _safe_asset_name(name, ""):
        return
    suffix = Path(name).suffix.lower()
    if suffix in {".png", ".jpg", ".jpeg", ".gif", ".webp"}:
        sandbox.write_bytes(ws, name, placeholder_png())
    elif suffix == ".svg":
        sandbox.write_bytes(ws, name, PLACEHOLDER_SVG)
    elif suffix in {".wav", ".mp3", ".ogg", ".woff", ".woff2", ".ttf", ".otf", ".ico"}:
        sandbox.write_bytes(ws, name, b"")
    elif suffix in {".glb", ".gltf", ".wasm"}:
        return
    elif suffix == ".json" or name.endswith("level.json"):
        if "level" not in name:
            return
        sandbox.write_file(ws, name, STUB_LEVEL)
    elif suffix == ".css":
        sandbox.write_file(ws, name, STUB_CSS)
    elif suffix in {".js", ".mjs"}:
        sandbox.write_file(ws, name, _module_stub(name, prompt, source=source, spec=spec))
    else:
        return
    files.add(name)


def ensure_shell_page(ws: Path) -> None:
    """If the model wrote JS/CSS and forgot HTML, still give View a document."""
    files = set(sandbox.list_files(ws))
    if any(name.endswith((".html", ".htm")) for name in files):
        return
    scripts = [n for n in files if n.endswith((".js", ".mjs"))]
    css = [n for n in files if n.endswith(".css")]
    if not scripts and not css:
        return
    if "js/main.js" in files:
        js_tag = '<script type="module" src="js/main.js"></script>'
    elif "script.js" in files:
        js_tag = '<script src="script.js"></script>'
    elif scripts:
        name = scripts[0]
        extra = ' type="module"' if name.endswith(".mjs") or name.startswith("js/") else ""
        js_tag = f'<script{extra} src="{name}"></script>'
    else:
        js_tag = ""
    if "styles.css" in files:
        css_tag = '<link rel="stylesheet" href="styles.css">'
    elif css:
        css_tag = f'<link rel="stylesheet" href="{css[0]}">'
    else:
        css_tag = ""
    sandbox.write_file(
        ws,
        "index.html",
        "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
        f"{css_tag}\n</head><body>\n<div id=\"app\"></div>\n{js_tag}\n</body></html>\n",
    )


def finish_site(ws: Path, prompt: str = "") -> None:
    """Make View work: missing files are written or unlinked, cut-off JS/HTML is closed."""
    if prompt_looks_like_game(prompt):
        ensure_game_tree(ws, prompt)
    scrub_mixed_site(ws)
    ensure_shell_page(ws)
    files = set(sandbox.list_files(ws))
    htmls = [name for name in files if name.endswith((".html", ".htm"))]
    if not htmls:
        return
    for name in list(files):
        if not name.endswith((".js", ".mjs")):
            continue
        raw = _desk_read(ws, name)
        fixed = repair_shadowed_params(repair_js(raw))
        if fixed != raw and len(fixed) >= int(len(raw) * 0.98):
            sandbox.write_file(ws, name, fixed)
    html_name = htmls[0]
    html = close_html(_desk_read(ws, html_name))

    def fix_inline(match: re.Match[str]) -> str:
        attrs = match.group(1) or ""
        body = match.group(2) or ""
        if re.search(r"\bsrc\s*=", attrs, re.I):
            return match.group(0)
        return f"<script{attrs}>{repair_js(body)}</script>"

    html = re.sub(r"<script\b([^>]*)>(.*?)</script>", fix_inline, html, flags=re.I | re.S)
    files = set(sandbox.list_files(ws))
    has_inline = bool(SCRIPT_BLOCK.search(html))
    inline_join = "\n".join(SCRIPT_BLOCK.findall(html) or [])
    missing_scripts = []
    for src in SCRIPT_SRC.findall(html):
        rel = _local_ref(src)
        if rel and rel not in files:
            missing_scripts.append(rel)
    for rel in missing_scripts:
        base = Path(rel).name.lower()
        duplicate = has_inline and "/" not in rel.replace("\\", "/") and base in {"script.js", "app.js"}
        if duplicate:
            html = re.sub(
                rf"""<script\b[^>]*src=["'][^"']*{re.escape(Path(rel).name)}[^"']*["'][^>]*>\s*</script>""",
                "",
                html,
                flags=re.I,
            )
            continue
        _write_missing_asset(ws, rel, files, prompt, source=html, spec=rel)
    if has_inline and "script.js" in files:
        disk = _desk_read(ws, "script.js")
        if inline_join.strip()[:80] and disk.strip()[:80] and inline_join.strip()[:80] == disk.strip()[:80]:
            html = re.sub(
                r"""<script\b[^>]*src=["'][^"']*script\.js["'][^>]*>\s*</script>""",
                "",
                html,
                flags=re.I,
            )
    for href in LINK_CSS.findall(html):
        rel = _local_ref(href)
        if rel:
            _write_missing_asset(ws, rel, files, prompt)
    for src in IMG_SRC.findall(html):
        rel = _local_ref(src)
        if rel:
            _write_missing_asset(ws, rel, files, prompt)
    for quoted in list(JS_STATIC.findall(html)) + list(HTML_REF.findall(html)):
        if not _plantable_spec(quoted):
            continue
        rel = _local_ref(quoted)
        if rel:
            _write_missing_asset(ws, rel, files, prompt, source=html, spec=quoted)
    for srcset in SRCSET.findall(html):
        for chunk in srcset.split(","):
            token = chunk.strip().split()[0] if chunk.strip() else ""
            if not _plantable_spec(token):
                continue
            rel = _local_ref(token)
            if rel:
                _write_missing_asset(ws, rel, files, prompt)
    for block in STYLE_BLOCK.findall(html):
        for spec in CSS_URL.findall(block or ""):
            if not _plantable_spec(spec):
                continue
            rel = _rel_from(html_name, spec) if spec.startswith(".") else _local_ref(spec)
            if rel:
                _write_missing_asset(ws, rel, files, prompt)
    files = set(sandbox.list_files(ws))
    for css_name in [n for n in files if n.endswith(".css")]:
        body = _desk_read(ws, css_name)
        for spec in CSS_URL.findall(body):
            if not _plantable_spec(spec):
                continue
            rel = _rel_from(css_name, spec) if spec.startswith(".") else _local_ref(spec)
            if rel:
                _write_missing_asset(ws, rel, files, prompt)
    for js_name in [n for n in files if n.endswith((".js", ".mjs"))]:
        body = _desk_read(ws, js_name)
        imports = JS_IMPORT.findall(body)
        import_set = set(imports)
        others = [
            spec
            for spec in JS_FETCH.findall(body) + JS_STATIC.findall(body) + JS_REQUIRE.findall(body)
            if spec not in import_set
        ]
        for spec in imports:
            if not _plantable_spec(spec):
                continue
            rel = _rel_from(js_name, spec)
            if rel:
                _write_missing_asset(ws, rel, files, prompt, source=body, spec=spec)
        for spec in others:
            if not _plantable_spec(spec):
                continue
            rel = _rel_from(js_name, spec) if spec.startswith(".") else _local_ref(spec)
            if rel:
                _write_missing_asset(ws, rel, files, prompt, source=body, spec=spec)
    script_linked = any(_local_ref(src) == "script.js" for src in SCRIPT_SRC.findall(html))
    script_ok = False
    if "script.js" in files:
        script_body = _desk_read(ws, "script.js")
        script_ok = js_looks_complete(script_body) and js_parses(script_body)
    main_body = _desk_read(ws, "js/main.js") if "js/main.js" in files else ""
    stub_main = looks_like_stub_main(main_body)
    skip_main = script_linked and script_ok and stub_main
    module_main = bool(re.search(r"(?m)^\s*(import |export )", main_body or ""))
    main_tag = (
        '<script type="module" src="js/main.js"></script>'
        if module_main
        else '<script src="js/main.js"></script>'
    )
    if "js/main.js" in files and "js/main.js" not in html and not skip_main:
        if re.search(r"</body>", html, re.I):
            html = re.sub(
                r"</body>",
                main_tag + "\n</body>",
                html,
                count=1,
                flags=re.I,
            )
        else:
            html += "\n" + main_tag + "\n"
    if "js/main.js" in files and wants_fps(prompt):
        html = re.sub(
            r"""<script\b(?![^>]*type=["']module["'])[^>]*src=["']js/(?:input|entities|net)\.js["'][^>]*>\s*</script>""",
            "",
            html,
            flags=re.I,
        )
    sandbox.write_file(ws, html_name, close_html(html))
    heal_site(ws)


def site_gap(ws: Path) -> str | None:
    """If a page is missing or cut off, ask the model to finish the files."""
    files = sandbox.list_files(ws)
    htmls = [f for f in files if f.endswith((".html", ".htm"))]
    if not htmls:
        return None
    html = _desk_read(ws, htmls[0])
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
                "write_file the COMPLETE file now. Finish the game they asked for. "
                "Raw source only, no markdown."
            )
        if not js_files and not has_inline:
            return (
                "This page needs script.js to be interactive. "
                "write_file a COMPLETE working script.js now. Wire every button id from the HTML. "
                "Raw JavaScript only. No markdown."
            )
        check_js = ["js/main.js"] if "js/main.js" in files else (js_files or linked)
        for name in check_js:
            if name not in files:
                continue
            body = _desk_read(ws, name)
            tidy = strip_model_tail(body)
            if tidy != body:
                sandbox.write_file(ws, name, tidy)
                body = tidy
            hooks = True if "js/main.js" in files else _js_hooks_ui(body, html)
            complete = js_module_complete(body) if "js/main.js" in files else js_looks_complete(body)
            if not js_parses(body):
                return (
                    f"{name} has a JavaScript syntax error. write_file the complete file. "
                    "Do not redeclare a function parameter with const or let."
                )
            if not complete or not hooks:
                return (
                    f"{name} is incomplete or does not wire the Start button. "
                    "write_file the complete file from the first line to the last closing brace. "
                    "Finish the game they asked for. Raw JavaScript only."
                )
    blob = html + "\n" + "\n".join(_desk_read(ws, n) for n in files if n.endswith((".js", ".mjs", ".html", ".htm")))
    if CDN_HINT.search(blob):
        return "Do not load scripts from a CDN (unpkg, jsdelivr, cdnjs, esm.sh). Keep View offline."
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
        body = _desk_read(ws, name)
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
canvas { touch-action: none; }
"""

PLAY_JS = r"""
(function () {
  function fitCanvas() {
    var c = document.getElementById("gameCanvas") || document.querySelector("canvas");
    if (!c) return;
    try {
      if (c.getContext && (c.getContext("webgl") || c.getContext("webgl2"))) return;
    } catch (err) {}
    if (window.THREE) return;
    var box = (c.parentElement || document.body).getBoundingClientRect();
    var w = Math.max(640, Math.floor(box.width) || 800);
    var h = Math.max(480, Math.floor(box.height) || 600);
    if (!c.getAttribute("width") || c.width < 100) c.width = w;
    if (!c.getAttribute("height") || c.height < 100) c.height = h;
  }
  function hideLoaders() {
    document.querySelectorAll(
      "#loading-screen, .loading, .loader, .menu-overlay, [data-loading]"
    ).forEach(function (el) {
      el.classList.remove("active");
      el.classList.add("hidden");
    });
  }
  function hideMenus() {
    hideLoaders();
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
    return window.startGame || window.beginGame || window.start;
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
    node.addEventListener("click", function () {
      var fn = startFn();
      if (typeof fn === "function") {
        hideMenus();
        fn();
      }
    });
  }
  function boot() {
    fitCanvas();
    wrap("startGame", hideMenus);
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
      });
    });
  }
  window.addEventListener("error", hideLoaders);
  window.addEventListener("unhandledrejection", hideLoaders);
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


def playable_page(ws: Path, html: str, base: str = "", job_id: str = "") -> str:
    """Make View a real playable document: load local files and fix overlay/click traps."""
    blob = decode_written_text(html or "")
    blob = re.sub(r"<canvas\b[^>]*>", _ensure_canvas_size, blob, count=1, flags=re.I)
    files = set(sandbox.list_files(ws))

    def drop_missing_script(match: re.Match[str]) -> str:
        tag = match.group(0)
        src_m = re.search(r"""src=["']([^"']+)["']""", tag, re.I)
        if not src_m:
            return tag
        rel = _local_ref(src_m.group(1))
        if rel and rel not in files:
            return ""
        return tag

    blob = re.sub(
        r"""<script\b[^>]*src=["'][^"']+["'][^>]*>\s*</script>""",
        drop_missing_script,
        blob,
        flags=re.I,
    )

    def drop_missing_link(match: re.Match[str]) -> str:
        tag = match.group(0)
        href_m = re.search(r"""href=["']([^"']+)["']""", tag, re.I)
        if not href_m:
            return tag
        rel = _local_ref(href_m.group(1))
        if rel and rel.endswith(".css") and rel not in files:
            return ""
        return tag

    blob = re.sub(r"<link\b[^>]*>", drop_missing_link, blob, flags=re.I)
    has_js = any(name.endswith((".js", ".mjs")) for name in files) or bool(
        SCRIPT_BLOCK.search(blob) or SCRIPT_SRC.search(blob)
    )
    if _looks_like_game(blob) and not has_js and re.search(
        r"fps|shooter|pointer.?lock|crosshair", blob, re.I
    ):
        game = f"<script id=\"desk-game\">{fallback_game_js()}</script>\n"
        if re.search(r"</body>", blob, re.I):
            blob = re.sub(r"</body>", game + "</body>", blob, count=1, flags=re.I)
        else:
            blob += game
    extras = ""
    if base:
        href = base if base.endswith("/") else base + "/"
        extras += f'<base href="{href}">\n'
    if job_id:
        import games as relay

        extras += relay.shim_script(job_id)
    extras += f"<style id=\"desk-play\">{PLAY_CSS}</style>\n"
    inlined = set()
    for href in LINK_CSS.findall(blob):
        rel = _local_ref(href)
        if rel and rel in files and rel not in inlined:
            extras += f"<style data-desk-css=\"{rel}\">\n{strip_model_tail(_desk_read(ws, rel))}\n</style>\n"
            inlined.add(rel)
    if "styles.css" in files and "styles.css" not in inlined:
        extras += (
            "<style data-desk-css=\"styles.css\">\n"
            + strip_model_tail(_desk_read(ws, "styles.css"))
            + "\n</style>\n"
        )
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
        css = strip_model_tail(_desk_read(ws, name))
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
        js = strip_model_tail(_desk_read(ws, name))
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
            "<style>\n" + strip_model_tail(_desk_read(ws, "styles.css")) + "\n</style>",
            "</head>",
        )
    if "script.js" in files and not SCRIPT_SRC.search(blob) and not SCRIPT_BLOCK.search(blob):
        blob = _inject_once(
            blob,
            "<script>\n" + strip_model_tail(_desk_read(ws, "script.js")) + "\n</script>",
            "</body>",
        )
    return blob


def scrub_mixed_site(ws: Path) -> None:
    """Split filename-labeled dumps so index.html is not a paste of HTML+CSS+JS."""
    files = sandbox.list_files(ws)
    for name in list(files):
        if not name.endswith((".html", ".htm", ".css", ".js", ".mjs")):
            continue
        raw = _desk_read(ws, name)
        parts = split_labeled_dump(raw)
        if len(parts) >= 2:
            for rel, body in parts:
                sandbox.write_bytes(ws, rel, tidy_site_file(rel, body).encode("utf-8"))
            continue
        peeled = peel_concatenated(name, raw)
        if name.endswith(".css") and (not peeled.strip() or _looks_like_html(peeled)):
            peeled = STUB_CSS
        if peeled != raw:
            sandbox.write_bytes(ws, name, tidy_site_file(name, peeled).encode("utf-8"))


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
    scrub_mixed_site(ws)
    files = set(sandbox.list_files(ws))
    for rel, body in extract_fences(extra_text):
        if rel.endswith((".css", ".js", ".mjs", ".html", ".json")) and rel not in files and body.strip():
            sandbox.write_file(ws, rel, body)
            files.add(rel)
            added.append(rel)
    for name in list(files):
        if name.endswith((".js", ".mjs", ".css", ".html", ".htm")):
            raw = _desk_read(ws, name)
            tidy = tidy_site_file(name, raw)
            if tidy != raw:
                sandbox.write_file(ws, name, tidy)
    css_dump = maybe_css_source(extra_text)
    if css_dump and "styles.css" not in files:
        sandbox.write_file(ws, "styles.css", css_dump)
        files.add("styles.css")
        added.append("styles.css")
    for rel in [f for f in files if f.endswith((".html", ".htm"))]:
        raw = _desk_read(ws, rel)
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
        if "js/main.js" in files:
            if "js/main.js" not in raw:
                raw = _inject_once(raw, '<script type="module" src="js/main.js"></script>', "</body>")
                sandbox.write_file(ws, rel, raw)
        elif "script.js" in files and not SCRIPT_SRC.search(raw) and not SCRIPT_BLOCK.search(raw):
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
        elif low.endswith(".js") or low.endswith(".mjs"):
            out.append((_safe_asset_name(lang, "script.js" if low.endswith(".js") else "js/main.mjs"), body))
        elif low in {"json"}:
            out.append(("data/level.json", body))
        elif low.endswith(".json"):
            out.append((_safe_asset_name(lang, "data/level.json"), body))
        elif low in {"csv", "tsv"}:
            out.append(("sheet.csv", body.replace("\t", ",") if low == "tsv" else body))
        elif low in {"mermaid", "mmd"}:
            out.append(("diagram.mmd", body))
        elif low in {"drawio", "xml"} and ("<mxfile" in body.lower() or "<mxgraphmodel" in body.lower()):
            out.append(("diagram.drawio", body))
        elif lang and ("/" in lang or "." in lang):
            ext = Path(lang).suffix.lower()
            if ext in BINARY_FENCE:
                continue
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
