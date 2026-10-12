"""Vision ingest and Playwright look-at tools for a job workspace."""

from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
from typing import Any

import sandbox

EYE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
PDF_EXT = {".pdf"}
MAX_EDGE = 1280
MAX_ENCODED = 2_000_000
MAX_IMAGES = 4
MAX_TOTAL = 8_000_000
MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def eyes_dir(ws: Path) -> Path:
    path = ws / "eyes"
    path.mkdir(parents=True, exist_ok=True)
    return path


def list_images(ws: Path) -> list[str]:
    names: list[str] = []
    for rel in sandbox.list_files(ws):
        low = rel.lower()
        if Path(low).suffix in EYE_EXTS:
            names.append(rel)
    names.sort()
    return names


def captions(ws: Path) -> str:
    rows = []
    for rel in list_images(ws):
        try:
            size = sandbox.resolve(ws, rel).stat().st_size
        except Exception:
            size = 0
        rows.append(f"{rel} ({size} bytes)")
    if not rows:
        return "No images on the desk."
    return "Images on the desk:\n" + "\n".join(rows)


def _safe_upload_name(name: str, fallback: str) -> str:
    raw = Path(name or fallback).name
    if not raw or ".." in raw:
        return fallback
    if not sandbox.SAFE_NAME.match(raw.replace("\\", "/")):
        stem = "".join(ch for ch in Path(raw).stem if ch.isalnum() or ch in "._-") or "eye"
        suffix = Path(raw).suffix.lower() if Path(raw).suffix.lower() in EYE_EXTS | PDF_EXT else ".png"
        return f"{stem}{suffix}"
    return raw


def save_bytes(ws: Path, filename: str, data: bytes) -> str:
    name = _safe_upload_name(filename, "eye.png")
    suffix = Path(name).suffix.lower()
    dest_rel = f"eyes/{name}"
    if suffix in PDF_EXT:
        sandbox.write_bytes(ws, dest_rel, data)
        png_rel = "eyes/page.png"
        err = raster_pdf(ws, dest_rel, png_rel)
        if err:
            raise ValueError(err)
        return png_rel
    if suffix not in EYE_EXTS:
        raise ValueError("only png, jpeg, webp, gif, or pdf")
    sandbox.write_bytes(ws, dest_rel, data)
    return dest_rel


async def save_uploads(job: dict[str, Any], files: list[Any]) -> list[str]:
    if not job:
        return []
    ws = sandbox.workspace(str(job["agent_id"]), str(job["id"]))
    written: list[str] = []
    for item in files[:MAX_IMAGES]:
        filename = getattr(item, "filename", None) or "eye.png"
        data = await item.read() if hasattr(item, "read") else bytes(item)
        if not data:
            continue
        written.append(save_bytes(ws, str(filename), data))
    return written


def encode_image(path: Path) -> tuple[str, str] | None:
    if not path.is_file():
        return None
    suffix = path.suffix.lower()
    mime = MIME.get(suffix) or "image/jpeg"
    raw = path.read_bytes()
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(raw))
        img = img.convert("RGB")
        w, h = img.size
        long_edge = max(w, h)
        if long_edge > MAX_EDGE:
            scale = MAX_EDGE / float(long_edge)
            img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))))
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82)
        raw = buf.getvalue()
        mime = "image/jpeg"
    except Exception:
        if len(raw) > MAX_ENCODED:
            return None
    if len(raw) > MAX_ENCODED:
        return None
    return base64.b64encode(raw).decode("ascii"), mime


def encode_many(ws: Path, rels: list[str]) -> list[tuple[str, str, str]]:
    out: list[tuple[str, str, str]] = []
    total = 0
    for rel in rels[:MAX_IMAGES]:
        try:
            path = sandbox.resolve(ws, rel)
        except ValueError:
            continue
        packed = encode_image(path)
        if not packed:
            continue
        b64, mime = packed
        size = len(b64)
        if total + size > MAX_TOTAL:
            break
        total += size
        out.append((rel, b64, mime))
    return out


def raster_pdf(ws: Path, src_rel: str, dest_rel: str) -> str | None:
    try:
        src = sandbox.resolve(ws, src_rel)
    except ValueError as e:
        return str(e)
    if not src.is_file():
        return "pdf missing"
    try:
        import pypdfium2

        doc = pypdfium2.PdfDocument(str(src))
        page = doc[0]
        bitmap = page.render(scale=2)
        pil = bitmap.to_pil()
        buf = io.BytesIO()
        pil.convert("RGB").save(buf, format="PNG")
        sandbox.write_bytes(ws, dest_rel, buf.getvalue())
        return None
    except Exception as e:
        return f"could not raster pdf page 1: {e}"


def _first_html(ws: Path) -> str | None:
    files = sandbox.list_files(ws)
    for name in files:
        if name.endswith((".html", ".htm")):
            return name
    return None


def _playwright_page():
    from playwright.sync_api import sync_playwright

    return sync_playwright()


def capture_view(ws: Path, dest_rel: str = "eyes/view.png", selector: str | None = None) -> str:
    html_name = _first_html(ws)
    if not html_name:
        return json.dumps({"error": "no playable page on this desk"})
    import local as site

    try:
        site.finish_site(ws)
    except Exception:
        pass
    raw = sandbox.read_full(ws, html_name)
    eyes_dir(ws)
    dest = sandbox.resolve(ws, dest_rel)
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        from playwright.sync_api import sync_playwright
    except Exception as e:
        return json.dumps({"error": f"playwright missing: {e}"})

    def _shoot() -> str:
        with sync_playwright() as p:
            try:
                browser = p.chromium.launch(channel="chrome", headless=True)
            except Exception:
                browser = p.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1280, "height": 800})
            job_id = ws.name
            host = os.getenv("HOST", "127.0.0.1")
            port = os.getenv("PORT", "8000")
            url = f"http://{host}:{port}/api/jobs/{job_id}/site/{html_name}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=8000)
            except Exception:
                html = site.playable_page(ws, raw, base=url.rsplit("/", 1)[0] + "/", job_id=job_id)
                page.set_content(html, wait_until="domcontentloaded")
            if selector:
                loc = page.locator(selector).first
                if loc.count():
                    loc.click(timeout=2000)
                    page.wait_for_timeout(1000)
                else:
                    browser.close()
                    return json.dumps({"error": f"no match for {selector}"})
            page.screenshot(path=str(dest), full_page=True)
            browser.close()
        rel = str(dest.relative_to(ws.resolve())).replace("\\", "/")
        return json.dumps({"ok": True, "path": rel})

    try:
        import asyncio

        asyncio.get_running_loop()
    except RuntimeError:
        try:
            return _shoot()
        except Exception as e:
            return json.dumps({"error": str(e)})
    from concurrent.futures import ThreadPoolExecutor

    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(_shoot).result(timeout=40)
    except Exception as e:
        return json.dumps({"error": str(e)})


def click_view(ws: Path, selector: str | None = None) -> str:
    target = selector or "#start-btn, [data-start], #btn-start, #play-btn"
    return capture_view(ws, "eyes/qa.png", selector=target)


def _chrome_skip(err: str) -> bool:
    low = (err or "").lower()
    return any(
        token in low
        for token in (
            "playwright missing",
            "executable doesn't exist",
            "browsertype.launch",
            "browser has been closed",
            "asyncio loop",
            "sync api",
        )
    )


def qa_start(ws: Path) -> dict[str, Any]:
    """Click Start and write eyes/qa.png. Missing Chrome is a skip, not a fail."""
    if not _first_html(ws):
        return {"skipped": True, "reason": "no page"}
    raw = click_view(ws)
    try:
        data = json.loads(raw)
    except Exception:
        return {"skipped": True, "reason": (raw or "")[:200]}
    if data.get("ok"):
        return {"ok": True, "path": data.get("path") or "eyes/qa.png"}
    err = str(data.get("error") or "click failed")
    if _chrome_skip(err):
        return {"skipped": True, "reason": err}
    return {"error": err}


def look_at(ws: Path, rel: str, has_vision: bool) -> str:
    try:
        path = sandbox.resolve(ws, rel)
    except ValueError as e:
        return json.dumps({"error": str(e)})
    if not path.is_file():
        return json.dumps({"error": f"missing {rel}"})
    suffix = path.suffix.lower()
    if suffix not in EYE_EXTS:
        return json.dumps({"error": "not an image"})
    if not has_vision:
        size = path.stat().st_size
        return (
            f"image on desk, model has no vision. path={rel} bytes={size}. "
            "Describe from the filename and continue with the files."
        )
    return json.dumps({"ok": True, "path": rel.replace("\\", "/"), "vision": True})
