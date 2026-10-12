"""Which brains a bay can use: OpenRouter, local Ollama, OpenCode Zen, Spark."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from typing import Any, Callable

import httpx
from dotenv import load_dotenv

import llm
import zen

load_dotenv()

OPENROUTER_BASE = (os.getenv("OPENROUTER_BASE_URL") or "https://openrouter.ai/api/v1").rstrip("/")
OPENROUTER_KEY = os.getenv("OPENROUTER_API_KEY") or ""
OLLAMA_BASE = (os.getenv("OLLAMA_BASE_URL") or "http://127.0.0.1:11434").rstrip("/")
# DGX Spark LiteLLM gateway (office LAN). Ollama on Spark is not open on the LAN.
SPARK_BASE = (os.getenv("SPARK_BASE_URL") or "http://192.168.100.129:4000/v1").rstrip("/")
SPARK2_BASE = (os.getenv("SPARK2_BASE_URL") or "http://192.168.100.127:4000/v1").rstrip("/")
SPARK_KEY = os.getenv("SPARK_API_KEY") or ""
SPARK2_KEY = os.getenv("SPARK2_API_KEY") or SPARK_KEY

# Three desks that fit a 24GB 4090. Names match this machine's Ollama tags.
LOCAL_PINNED: list[dict[str, str]] = [
    {
        "id": "local:qwen3:14b",
        "name": "Qwen3 14B",
        "provider": "local",
        "backend": "qwen3:14b",
        "hint": "This machine · everyday jobs · tools",
        "vram": "~10 GB",
    },
    {
        "id": "local:qwen3.6:35b-a3b",
        "name": "Qwen3.6 35B",
        "provider": "local",
        "backend": "qwen3.6:35b-a3b",
        "hint": "This machine · MoE on a 4090 · heavier jobs",
        "vram": "~22 GB",
    },
    {
        "id": "local:qwen3-vl:8b",
        "name": "Qwen3 VL 8B",
        "provider": "local",
        "backend": "qwen3-vl:8b",
        "hint": "This machine · fast · vision",
        "vram": "~6 GB",
    },
]

OPENROUTER_PINNED: list[dict[str, str]] = [
    {
        "id": "openrouter:deepseek/deepseek-chat",
        "name": "DeepSeek V3",
        "provider": "openrouter",
        "backend": "deepseek/deepseek-chat",
        "hint": "OpenRouter · strong coder",
        "vram": "",
    },
    {
        "id": "openrouter:google/gemini-2.5-flash",
        "name": "Gemini 2.5 Flash",
        "provider": "openrouter",
        "backend": "google/gemini-2.5-flash",
        "hint": "OpenRouter · fast general",
        "vram": "",
    },
    {
        "id": "openrouter:openai/gpt-4o-mini",
        "name": "GPT-4o mini",
        "provider": "openrouter",
        "backend": "openai/gpt-4o-mini",
        "hint": "OpenRouter · cheap and steady",
        "vram": "",
    },
]

ZEN_PINNED: list[dict[str, str]] = [
    {
        "id": model,
        "name": "Big Pickle" if model == "big-pickle" else model,
        "provider": "zen",
        "backend": model,
        "hint": "OpenCode Zen · free tier",
        "vram": "",
    }
    for model in zen.CHAT_MODELS
]

# Chat routes on Spark 1's LiteLLM gateway. Whisper / embeddings stay off this list.
SPARK_PINNED: list[dict[str, str]] = [
    {
        "id": "spark:qwen3.6:35b-a3b",
        "name": "Qwen3.6 35B",
        "provider": "spark",
        "backend": "qwen3.6:35b-a3b",
        "hint": "Spark · everyday jobs · tools",
        "vram": "MoE · 32K",
    },
    {
        "id": "spark:qwen3.8",
        "name": "Qwen3.8 27B",
        "provider": "spark",
        "backend": "qwen3.8",
        "hint": "Spark · strongest general · tools",
        "vram": "~17 GB",
    },
    {
        "id": "spark:qwen3-vl:32b",
        "name": "Qwen3 VL 32B",
        "provider": "spark",
        "backend": "qwen3-vl:32b",
        "hint": "Spark · vision · loads on demand",
        "vram": "~20 GB",
    },
    {
        "id": "spark:qwen3-vl:8b",
        "name": "Qwen3 VL 8B",
        "provider": "spark",
        "backend": "qwen3-vl:8b",
        "hint": "Spark · fast vision",
        "vram": "~6 GB",
    },
]
_SPARK_HIDE = {
    "bge-m3",
    "whisper-large-v3",
    "qwen3.6-35b",
    "qwen3.8:latest",
    "qwen3.6-35b-nvfp4",
    "qwen38-flash-next-nvfp4",
    "flash-next",
}

_ollama_models: set[str] = set()
_ollama_until = 0.0
_openrouter_ok = False
_openrouter_until = 0.0
_spark_models: set[str] = set()
_spark_until = 0.0
_spark_ok = False
_spark2_ok = False
_spark2_until = 0.0
# One Ollama generation at a time — a 4090 cannot hold two big local models.
_gpu_lock = asyncio.Lock()
# Each Spark box queues extra Ollama streams until the first finishes, so the
# factory keeps one live generation per box and sends the next desk elsewhere.
_spark_box_use: dict[str, int] = {}
_spark_box_lock = asyncio.Lock()
_local_lock = asyncio.Lock()
_openrouter_lock = asyncio.Lock()
_spark_lock = asyncio.Lock()
_bg_tasks: set[asyncio.Task] = set()
_aborted: set[str] = set()
_stream_clients: dict[str, list[httpx.AsyncClient]] = {}
_local_backend: dict[str, str] = {}


def job_aborted(job_id: str) -> bool:
    return bool(job_id) and job_id in _aborted


def clear_abort(job_id: str) -> None:
    if not job_id:
        return
    _aborted.discard(job_id)
    _stream_clients.pop(job_id, None)
    _local_backend.pop(job_id, None)


def _raise_if_aborted(job_id: str) -> None:
    if job_aborted(job_id):
        raise asyncio.CancelledError


def _track_client(job_id: str, client: httpx.AsyncClient) -> None:
    if not job_id:
        return
    _stream_clients.setdefault(job_id, []).append(client)


def _untrack_client(job_id: str, client: httpx.AsyncClient) -> None:
    if not job_id:
        return
    bucket = _stream_clients.get(job_id) or []
    if client in bucket:
        bucket.remove(client)
    if not bucket:
        _stream_clients.pop(job_id, None)


async def _ollama_stop(backend: str) -> None:
    """Drop the in-flight Ollama runner so VRAM and compute actually go idle."""
    name = (backend or "").strip()
    if not name:
        return
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.post(
                f"{OLLAMA_BASE}/api/generate",
                json={"model": name, "prompt": "", "keep_alive": 0, "stream": False},
            )
    except Exception:
        pass


async def abort_in_flight(job_id: str, backend: str = "") -> None:
    """Close the live HTTP stream and unload the local model. Stop must kill GPU work."""
    if not job_id:
        return
    _aborted.add(job_id)
    name = backend or _local_backend.get(job_id) or ""
    clients = list(_stream_clients.get(job_id) or [])
    for client in clients:
        try:
            await client.aclose()
        except Exception:
            pass
    if name:
        await _ollama_stop(name)


def _spawn(coro: Any) -> None:
    try:
        task = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        return
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


def _entry(row: dict[str, str], available: bool) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "provider": row["provider"],
        "backend": row["backend"],
        "hint": row["hint"],
        "vram": row.get("vram") or "",
        "available": available,
    }


def parse_model(model_id: str) -> tuple[str, str]:
    raw = (model_id or "").strip()
    if raw.startswith("openrouter:"):
        return "openrouter", raw.split(":", 1)[1]
    if raw.startswith("local:") or raw.startswith("ollama:"):
        return "local", raw.split(":", 1)[1]
    if raw.startswith("spark:"):
        return "spark", raw.split(":", 1)[1]
    if raw.startswith("zen:"):
        return "zen", raw.split(":", 1)[1]
    if "/" in raw:
        return "openrouter", raw
    return "zen", raw or "big-pickle"


def known_ids() -> set[str]:
    ids = {row["id"] for row in LOCAL_PINNED + OPENROUTER_PINNED + ZEN_PINNED + SPARK_PINNED}
    ids.update(zen.CHAT_MODELS)
    return ids


def openrouter_enabled() -> bool:
    return bool(OPENROUTER_KEY)


def spark_enabled() -> bool:
    return bool(SPARK_KEY)


def spark_reachable() -> bool:
    return _spark_ok


def _spark_v1(url: str | None = None) -> str:
    raw = (url or SPARK_BASE).rstrip("/")
    if not raw.endswith("/v1"):
        raw += "/v1"
    return raw


async def claim_spark_box() -> str | None:
    boxes = [_spark_v1(SPARK_BASE)]
    if _spark2_ok:
        other = _spark_v1(SPARK2_BASE)
        if other not in boxes:
            boxes.append(other)
    async with _spark_box_lock:
        for box in boxes:
            if _spark_box_use.get(box, 0) < 1:
                _spark_box_use[box] = _spark_box_use.get(box, 0) + 1
                return box
        return None


def spark_busy() -> bool:
    return any(n > 0 for n in _spark_box_use.values())


async def release_spark_box(box: str) -> None:
    async with _spark_box_lock:
        _spark_box_use[box] = max(0, _spark_box_use.get(box, 0) - 1)


def is_vision_model(model_id: str) -> bool:
    low = (model_id or "").lower()
    return any(token in low for token in ("-vl", "vl:", "vision", "gpt-4o", "gemini"))


def model_accepts_images(model_id: str) -> bool:
    """Name says VL *and* that backend is actually on the box we would call."""
    if not is_vision_model(model_id):
        return False
    provider, backend = parse_model(model_id)
    if provider == "spark":
        return backend in _spark_models
    if provider == "local":
        return not _ollama_models or backend in _ollama_models
    return True


def pick_vision_model(agent: dict[str, Any] | None = None) -> str | None:
    current = str((agent or {}).get("model") or "")
    if model_accepts_images(current):
        return current
    spark_desk = current.startswith("spark:")
    spark_cands = ["spark:qwen3-vl:32b", "spark:qwen3-vl:8b"]
    local_cands = ["local:qwen3-vl:8b"]
    candidates = spark_cands + local_cands if spark_desk else local_cands + spark_cands
    backends = _ollama_models
    for mid in candidates:
        _provider, backend = parse_model(mid)
        if mid.startswith("local:") and backends and backend not in backends:
            continue
        if mid.startswith("spark:"):
            if not spark_enabled():
                continue
            if backend not in _spark_models:
                continue
        if spark_desk and mid.startswith("local:"):
            return None
        return mid
    return None


def user_with_images(text: str, ws: Any, rels: list[str]) -> dict[str, Any]:
    import eyes as vision

    packed = vision.encode_many(ws, rels)
    if not packed:
        return {"role": "user", "content": text}
    images = [b64 for _rel, b64, _mime in packed]
    parts: list[dict[str, Any]] = [{"type": "text", "text": text}]
    for _rel, b64, mime in packed:
        parts.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
    return {"role": "user", "content": parts, "images": images}


def messages_have_images(messages: list[dict[str, Any]]) -> bool:
    for m in messages:
        if m.get("images"):
            return True
        content = m.get("content")
        if isinstance(content, list) and any(
            isinstance(p, dict) and p.get("type") == "image_url" for p in content
        ):
            return True
    return False


def text_only_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop image_url / images so a text model never sees a multimodal body."""
    out: list[dict[str, Any]] = []
    for m in messages:
        item = {k: v for k, v in m.items() if k != "images"}
        content = item.get("content")
        if isinstance(content, list):
            texts = [
                str(p.get("text") or "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            note = "\n".join(t for t in texts if t).strip()
            item["content"] = note or "[image omitted — this model has no vision]"
        out.append(item)
    return out


def is_multimodal_reject(message: str) -> bool:
    low = (message or "").lower()
    return "multimodal" in low and "not support" in low


def _openai_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        item = {k: v for k, v in m.items() if k not in {"images"}}
        out.append(item)
    return out


def default_model_id() -> str:
    """First available local model, else Spark, else OpenRouter, else Zen."""
    if _ollama_models:
        for row in LOCAL_PINNED:
            if row["backend"] in _ollama_models:
                return row["id"]
        return f"local:{next(iter(_ollama_models))}"
    if spark_enabled():
        return SPARK_PINNED[0]["id"]
    if openrouter_enabled():
        return OPENROUTER_PINNED[0]["id"]
    return "big-pickle"


def label_for(model_id: str) -> str:
    raw = (model_id or "").strip()
    for row in LOCAL_PINNED + OPENROUTER_PINNED + ZEN_PINNED + SPARK_PINNED:
        if row["id"] == raw:
            return row["name"]
    provider, backend = parse_model(raw)
    if provider == "openrouter":
        return backend.split("/")[-1] or backend
    if provider == "spark":
        return f"Spark {backend}"
    return backend or "the selected model"


def failover_chain(primary: str) -> list[str]:
    mid = (primary or "").strip() or default_model_id()
    chain = [mid]
    primary_provider, _backend = parse_model(mid)
    extras: list[str] = []
    if openrouter_enabled():
        extras.append("openrouter:deepseek/deepseek-chat")
    if os.getenv("OPENCODE_API_KEY") and zen.CHAT_MODELS:
        extras.append(zen.CHAT_MODELS[0])
    extras.append("local:qwen3:14b")
    for item in extras:
        provider, _backend = parse_model(item)
        if provider == primary_provider or item in chain:
            continue
        chain.append(item)
    return chain


def _openrouter_headers() -> dict[str, str]:
    if not OPENROUTER_KEY:
        raise zen.ZenError(401, "OPENROUTER_API_KEY is missing")
    return {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:3000",
        "X-Title": "Personal Factory",
    }


def _read_json(r: httpx.Response) -> Any:
    try:
        return r.json()
    except Exception:
        return None


def _json_rows(payload: Any, key: str) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        rows = payload.get(key)
        return rows if isinstance(rows, list) else []
    return []


async def refresh_local() -> set[str]:
    global _ollama_models, _ollama_until
    async with _local_lock:
        now = time.monotonic()
        if _ollama_until > now:
            return _ollama_models
        found: set[str] = set()
        try:
            async with httpx.AsyncClient(timeout=1.2) as client:
                r = await client.get(f"{OLLAMA_BASE}/api/tags")
                if r.status_code < 400:
                    for item in _json_rows(_read_json(r), "models"):
                        if not isinstance(item, dict):
                            continue
                        name = item.get("name") or ""
                        if name:
                            found.add(name)
                            found.add(name.split(":")[0])
        except Exception:
            found = set()
        _ollama_models = found
        _ollama_until = now + (20 if found else 8)
        return found


async def refresh_openrouter() -> bool:
    global _openrouter_until, _openrouter_ok
    async with _openrouter_lock:
        now = time.monotonic()
        if not OPENROUTER_KEY:
            _openrouter_ok = False
            return False
        if _openrouter_until > now:
            return _openrouter_ok
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                r = await client.get(f"{OPENROUTER_BASE}/models", headers=_openrouter_headers())
                ok = r.status_code < 400
        except Exception:
            ok = False
        _openrouter_ok = ok
        _openrouter_until = now + (60 if ok else 30)
        return ok


def _spark_chat_name(name: str) -> bool:
    low = (name or "").lower()
    if name in _SPARK_HIDE:
        return False
    return not any(marker in low for marker in ("whisper", "embed", "bge-", "audio", "nvfp4"))


async def refresh_spark() -> set[str]:
    global _spark_models, _spark_until, _spark_ok
    async with _spark_lock:
        now = time.monotonic()
        if _spark_until > now:
            return _spark_models
        if spark_busy():
            # Listing models while a generation is in flight stalls LiteLLM / Ollama.
            _spark_until = now + 30
            return _spark_models
        found: set[str] = set()
        ok = False
        if SPARK_KEY:
            try:
                async with httpx.AsyncClient(timeout=2.0) as client:
                    r = await client.get(
                        f"{_spark_v1()}/models",
                        headers={"Authorization": f"Bearer {SPARK_KEY}"},
                    )
                    if r.status_code < 400:
                        ok = True
                        for item in _json_rows(_read_json(r), "data"):
                            raw = item.get("id") if isinstance(item, dict) else item
                            mid = str(raw or "").strip()
                            if mid:
                                found.add(mid)
            except Exception:
                ok = False
        else:
            origin = _spark_v1()[:-3] if _spark_v1().endswith("/v1") else _spark_v1()
            try:
                async with httpx.AsyncClient(timeout=1.5) as client:
                    r = await client.get(f"{origin}/health/liveliness")
                    ok = r.status_code < 400
            except Exception:
                ok = False
        if ok:
            _spark_ok = True
            if found:
                _spark_models = found
            _spark_until = now + 60
        else:
            # Keep the last good list. A busy/timeout probe is not "Spark died."
            _spark_until = now + 60
            if not _spark_models:
                _spark_ok = False
        return _spark_models


async def refresh_spark2() -> bool:
    """Spark 2 uses a different LiteLLM engineer key. Skip it until that key works."""
    global _spark2_ok, _spark2_until
    now = time.monotonic()
    if _spark2_until > now:
        return _spark2_ok
    ok = False
    reason = "unreachable"
    if not SPARK2_KEY:
        reason = "key missing"
    elif SPARK2_BASE:
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(
                    f"{_spark_v1(SPARK2_BASE)}/models",
                    headers={"Authorization": f"Bearer {SPARK2_KEY}"},
                )
                ok = r.status_code < 400
                if r.status_code in {401, 403}:
                    reason = "key rejected"
                elif not ok:
                    reason = "unreachable"
        except Exception:
            ok = False
            reason = "unreachable"
    _spark2_ok = ok
    _spark2_until = now + (20 if ok else 60)
    try:
        import plant

        plant.set_spark2(ok, reason)
    except Exception:
        pass
    return ok


async def openai_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    timeout: float = 180,
    extra_headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    url = base_url.rstrip("/")
    if not url.endswith("/v1"):
        url = url + "/v1"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    payload: dict[str, Any] = {
        "model": model,
        "messages": _openai_messages(messages),
        "temperature": 0.3,
        "max_tokens": 65536,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    last: zen.ZenError | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for use_tools in ((True, False) if tools else (False,)):
            body = payload if use_tools else {k: v for k, v in payload.items() if k not in {"tools", "tool_choice"}}
            try:
                r = await client.post(f"{url}/chat/completions", headers=headers, json=body)
            except httpx.TimeoutException:
                last = zen.ZenError(504, f"{model} timed out")
                continue
            except httpx.HTTPError as e:
                raise zen.ZenError(503, f"{model} unreachable") from e
            if r.status_code < 400:
                data = r.json()
                zen._promote_reasoning(data)
                if not (data.get("choices") or [{}])[0].get("message"):
                    raise zen.ZenError(502, f"{model} returned no message")
                return data
            err = zen.ZenError(r.status_code, zen._friendly(r.status_code, r.text))
            last = err
            if use_tools and r.status_code in {400, 404, 422}:
                continue
            raise err
    raise last or zen.ZenError(502, f"{model} returned no response")


TokenCb = Callable[[str], None]
Caption = Callable[[str], None]


def _only_new(previous: str, incoming: str) -> tuple[str, str]:
    """Turn either incremental tokens or full snapshots into a true delta."""
    if not incoming:
        return "", previous
    if previous and incoming.startswith(previous):
        return incoming[len(previous) :], incoming
    if previous and previous.startswith(incoming):
        return "", previous
    if previous:
        max_ov = min(len(previous), len(incoming), 80)
        for n in range(max_ov, 8, -1):
            if previous.endswith(incoming[:n]):
                rest = incoming[n:]
                return rest, previous + rest
    return incoming, previous + incoming


def _json_string_after_key(buf: str, key: str) -> str:
    """Read a JSON string value that may still be incomplete (streaming tool args)."""
    m = re.search(rf'"{re.escape(key)}"\s*:\s*"', buf)
    if not m:
        return ""
    s = buf[m.end() :]
    out: list[str] = []
    i = 0
    while i < len(s):
        ch = s[i]
        if ch == '"':
            break
        if ch != "\\":
            out.append(ch)
            i += 1
            continue
        if i + 1 >= len(s):
            break
        nxt = s[i + 1]
        mapping = {"n": "\n", "t": "\t", "r": "\r", '"': '"', "/": "/", "\\": "\\"}
        if nxt in mapping:
            out.append(mapping[nxt])
            i += 2
            continue
        if nxt == "u" and i + 5 < len(s):
            try:
                out.append(chr(int(s[i + 2 : i + 6], 16)))
                i += 6
                continue
            except ValueError:
                break
        break
    return "".join(out)


def _write_file_body(args: Any) -> str:
    if isinstance(args, dict):
        return str(args.get("content") or "")
    text = str(args or "")
    if not text:
        return ""
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return str(data.get("content") or "")
    except json.JSONDecodeError:
        pass
    return _json_string_after_key(text, "content")


class _WriteFileStream:
    """Live-type the file body while write_file arguments are still streaming in."""

    def __init__(self, on_token: TokenCb | None) -> None:
        self.on_token = on_token
        self.names: dict[int, str] = {}
        self.args: dict[int, str] = {}
        self.seen: dict[int, int] = {}

    def feed(self, deltas: list[Any]) -> None:
        if not self.on_token:
            return
        for item in deltas:
            if not isinstance(item, dict):
                continue
            idx = int(item.get("index") or 0)
            fn = item.get("function") or {}
            if fn.get("name"):
                self.names[idx] = str(fn["name"])
            raw = fn.get("arguments")
            if raw in (None, ""):
                continue
            if isinstance(raw, dict):
                self.args[idx] = json.dumps(raw, ensure_ascii=False)
            else:
                incoming = str(raw)
                prev = self.args.get(idx, "")
                self.args[idx] = _merge_arg_text(prev, incoming)
            name = self.names.get(idx, "")
            if name and name != "write_file":
                continue
            body = _write_file_body(self.args[idx])
            prev = self.seen.get(idx, 0)
            if len(body) > prev:
                self.on_token(body[prev:])
                self.seen[idx] = len(body)


def collapse_repeats(text: str) -> str:
    if not text:
        return ""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    seen: set[str] = set()
    for p in paras:
        key = re.sub(r"\s+", " ", p)
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    lines: list[str] = []
    last = None
    for line in "\n\n".join(out).split("\n"):
        if line == last:
            continue
        lines.append(line)
        last = line
    return "\n".join(lines).strip()


_THINK_BLOCK = re.compile(
    r"<think>.*?</think>|<thinking>.*?</thinking>|◁think▷.*?◁/think▷",
    re.S | re.I,
)
_THINK_OPEN = re.compile(r"<think>.*$|<thinking>.*$|◁think▷.*$", re.S | re.I)


def strip_thinking(text: str) -> str:
    cleaned = _THINK_BLOCK.sub("", text or "")
    cleaned = _THINK_OPEN.sub("", cleaned)
    cleaned = re.sub(r"</think>|</thinking>|◁/think▷", "", cleaned, flags=re.I)
    return cleaned.strip()


def is_tool_json_error(message: str) -> bool:
    blob = (message or "").lower()
    return any(
        marker in blob
        for marker in (
            "closing '}'",
            "can't find closing",
            "looks like object",
            "invalid json",
            "tool call",
            "unterminated string",
            "unexpected eof",
        )
    )


def looks_cut_off(text: str) -> bool:
    body = (text or "").rstrip()
    if not body or len(body) < 80:
        return False
    if body.endswith(("…", "...", " -", " —")):
        return True
    last = body[-1]
    if last in ".!?…\"'”’):;":
        return False
    return last.isalnum()


def context_limited(err: zen.ZenError) -> bool:
    msg = (err.message or "").lower()
    if err.status not in {400, 413, 422}:
        return False
    needles = (
        "max_tokens",
        "max tokens",
        "max_completion_tokens",
        "context length",
        "context window",
        "too many tokens",
        "maximum context",
        "reduce the length",
        "token limit",
        "this model's maximum",
        "n_ctx",
        "num_ctx",
    )
    if any(token in msg for token in needles):
        return True
    return "token" in msg and any(
        word in msg for word in ("context", "window", "limit", "too long", "too large")
    )


class _StreamGate:
    """Dedup snapshots, keep thinking off the answer channel."""

    def __init__(self, on_token: TokenCb | None, on_think: TokenCb | None = None) -> None:
        self.on_token = on_token
        self.on_think = on_think
        self.content = ""
        self.reason = ""
        self.answer = ""
        self.tag_buf = ""
        self.in_think = False

    def push_reason(self, incoming: str) -> None:
        delta, self.reason = _only_new(self.reason, incoming)
        if delta and self.on_think:
            self.on_think(delta)

    def push_content(self, incoming: str) -> None:
        delta, self.content = _only_new(self.content, incoming)
        if delta:
            self._emit_tagged(delta)

    def _emit_answer(self, text: str) -> None:
        if not text:
            return
        self.answer += text
        if self.on_token:
            self.on_token(text)

    def _emit_tagged(self, chunk: str) -> None:
        self.tag_buf += chunk
        while self.tag_buf:
            low = self.tag_buf.lower()
            if not self.in_think:
                i = low.find("<think>")
                if i < 0:
                    text = self.tag_buf
                    self.tag_buf = ""
                    self._emit_answer(text)
                    return
                before = self.tag_buf[:i]
                self.tag_buf = self.tag_buf[i + 7 :]
                self.in_think = True
                self._emit_answer(before)
            else:
                i = low.find("</think>")
                if i < 0:
                    body = self.tag_buf
                    self.tag_buf = ""
                    if body and self.on_think:
                        self.on_think(body)
                    return
                body = self.tag_buf[:i]
                self.tag_buf = self.tag_buf[i + 8 :]
                self.in_think = False
                if body and self.on_think:
                    self.on_think(body)

    def finish(self) -> str:
        if self.tag_buf and not self.in_think:
            self._emit_answer(self.tag_buf)
        self.tag_buf = ""
        answer = self.answer.strip()
        if answer:
            return collapse_repeats(strip_thinking(answer))
        return collapse_repeats(strip_thinking(self.content))


def _merge_arg_text(previous: str, incoming: str) -> str:
    """Ollama often resends the whole tool-call snapshot. Don't concatenate those."""
    if not previous:
        return incoming
    if incoming.startswith(previous) or previous.startswith(incoming):
        return incoming if len(incoming) >= len(previous) else previous
    if incoming.startswith("{") and previous.startswith("{"):
        return incoming if len(incoming) >= len(previous) else previous
    return previous + incoming


def _merge_tool_delta(acc: dict[int, dict[str, Any]], deltas: list[Any]) -> None:
    for item in deltas:
        if not isinstance(item, dict):
            continue
        idx = int(item.get("index") or 0)
        slot = acc.setdefault(
            idx,
            {"id": "", "type": "function", "function": {"name": "", "arguments": ""}},
        )
        if item.get("id"):
            slot["id"] = item["id"]
        if item.get("type"):
            slot["type"] = item["type"]
        fn = item.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] = fn["name"]
        if fn.get("arguments") not in (None, ""):
            args = fn["arguments"]
            if not isinstance(args, str):
                args = json.dumps(args)
            prev = slot["function"]["arguments"]
            slot["function"]["arguments"] = _merge_arg_text(prev, args)


def _packed_message(
    content: str, reasoning: str, tool_acc: dict[int, dict[str, Any]]
) -> dict[str, Any]:
    cleaned = collapse_repeats(strip_thinking(content))
    msg: dict[str, Any] = {"role": "assistant", "content": cleaned}
    if tool_acc:
        msg["tool_calls"] = [tool_acc[i] for i in sorted(tool_acc)]
    if reasoning:
        msg["reasoning"] = reasoning
    return {"choices": [{"message": msg}]}


def _packed_from_gate(sink: _StreamGate, tool_acc: dict[int, dict[str, Any]]) -> dict[str, Any]:
    return _packed_message(sink.finish(), sink.reason, tool_acc)


def _delta_text(delta: dict[str, Any]) -> tuple[str, str]:
    content = delta.get("content") or ""
    if isinstance(content, list):
        content = "".join(
            part if isinstance(part, str) else str(part.get("text") or "")
            for part in content
        )
    reason = (
        delta.get("reasoning")
        or delta.get("reasoning_content")
        or delta.get("thinking")
        or ""
    )
    if isinstance(reason, list):
        reason = "".join(
            part.get("text") or "" for part in reason if isinstance(part, dict)
        )
    return str(content), str(reason)


async def _openai_with_token_ladder(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    *,
    tools: list[dict[str, Any]] | None,
    timeout: float,
    token_steps: tuple[int, ...],
    extra_headers: dict[str, str] | None = None,
    extra_payload: dict[str, Any] | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
    job_id: str = "",
) -> dict[str, Any]:
    last: zen.ZenError | None = None
    for i, tokens in enumerate(token_steps):
        _raise_if_aborted(job_id)
        try:
            return await openai_chat_stream(
                base_url,
                api_key,
                model,
                messages,
                tools=tools,
                timeout=timeout,
                extra_headers=extra_headers,
                extra_payload=extra_payload,
                on_token=on_token,
                on_think=on_think,
                max_tokens=tokens,
                job_id=job_id,
            )
        except asyncio.CancelledError:
            raise
        except zen.ZenError as err:
            if job_aborted(job_id):
                raise asyncio.CancelledError from err
            last = err
            if i < len(token_steps) - 1 and context_limited(err):
                continue
            raise
    raise last or zen.ZenError(502, f"{model} returned no response")


async def openai_chat_stream(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    timeout: float = 180,
    extra_headers: dict[str, str] | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
    max_tokens: int = 65536,
    extra_payload: dict[str, Any] | None = None,
    job_id: str = "",
) -> dict[str, Any]:
    url = base_url.rstrip("/")
    if not url.endswith("/v1"):
        url = url + "/v1"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    payload: dict[str, Any] = {
        "model": model,
        "messages": _openai_messages(messages),
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if extra_payload:
        payload.update(extra_payload)
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    last: zen.ZenError | None = None
    timeout_cfg = httpx.Timeout(timeout, connect=12.0, read=timeout, write=30.0)
    _raise_if_aborted(job_id)
    client = httpx.AsyncClient(timeout=timeout_cfg)
    _track_client(job_id, client)
    try:
        async with client:
            for use_tools in (True, False) if tools else (False,):
                _raise_if_aborted(job_id)
                body = (
                    payload
                    if use_tools
                    else {k: v for k, v in payload.items() if k not in {"tools", "tool_choice"}}
                )
                sink = _StreamGate(on_token, on_think)
                tool_acc: dict[int, dict[str, Any]] = {}
                files = _WriteFileStream(on_token)
                try:
                    async with client.stream(
                        "POST",
                        f"{url}/chat/completions",
                        headers={**headers, "Accept": "text/event-stream"},
                        json=body,
                    ) as r:
                        if r.status_code >= 400:
                            err_body = (await r.aread()).decode("utf-8", "replace")
                            err = zen.ZenError(r.status_code, zen._friendly(r.status_code, err_body))
                            last = err
                            if use_tools and r.status_code in {400, 404, 422}:
                                continue
                            raise err
                        async for line in r.aiter_lines():
                            _raise_if_aborted(job_id)
                            if not line:
                                continue
                            if line.startswith(":"):
                                continue
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            choice = (chunk.get("choices") or [{}])[0]
                            delta = choice.get("delta") or {}
                            piece, reason = _delta_text(delta)
                            if reason:
                                sink.push_reason(reason)
                            if piece:
                                sink.push_content(piece)
                            if delta.get("tool_calls"):
                                _merge_tool_delta(tool_acc, delta["tool_calls"])
                                files.feed(delta["tool_calls"])
                            if choice.get("finish_reason"):
                                break
                            await asyncio.sleep(0)
                except asyncio.CancelledError:
                    raise
                except httpx.TimeoutException:
                    if job_aborted(job_id):
                        raise asyncio.CancelledError
                    last = zen.ZenError(504, f"{model} timed out")
                    continue
                except httpx.HTTPError as e:
                    if job_aborted(job_id):
                        raise asyncio.CancelledError from e
                    raise zen.ZenError(503, f"{model} unreachable") from e
                return _packed_from_gate(sink, tool_acc)
    finally:
        _untrack_client(job_id, client)
    if last:
        if job_aborted(job_id):
            raise asyncio.CancelledError
        raise last
    return await openai_chat(
        base_url,
        api_key,
        model,
        messages,
        tools=tools,
        timeout=timeout,
        extra_headers=extra_headers,
    )


def _ollama_tool_args(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _ollama_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role") or "user"
        content = m.get("content")
        text = content
        if isinstance(content, list):
            text = " ".join(
                str(p.get("text") or "")
                for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            )
        item: dict[str, Any] = {
            "role": "tool" if role == "tool" else role,
            "content": text or "",
        }
        if m.get("images"):
            item["images"] = m["images"]
        if m.get("tool_calls"):
            calls: list[dict[str, Any]] = []
            for call in m["tool_calls"]:
                if not isinstance(call, dict):
                    continue
                fn = call.get("function") or {}
                name = fn.get("name") or ""
                if not name:
                    continue
                calls.append(
                    {
                        "function": {
                            "name": name,
                            "arguments": _ollama_tool_args(fn.get("arguments")),
                        }
                    }
                )
            if calls:
                item["tool_calls"] = calls
        if role == "tool":
            name = m.get("name") or m.get("tool_name") or ""
            if name:
                item["tool_name"] = name
        out.append(item)
    return out


async def ollama_chat_stream(
    backend: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
    timeout: float = 300,
    job_id: str = "",
) -> dict[str, Any]:
    timeout_cfg = httpx.Timeout(timeout, connect=12.0, read=timeout, write=30.0)
    payload: dict[str, Any] = {
        "model": backend,
        "messages": _ollama_messages(messages),
        "stream": True,
        "think": False,
        "options": {"temperature": 0.3, "num_predict": 32768, "num_ctx": 32768},
    }
    if tools:
        payload["tools"] = tools
    last: zen.ZenError | None = None
    _raise_if_aborted(job_id)
    client = httpx.AsyncClient(timeout=timeout_cfg)
    _track_client(job_id, client)
    try:
        async with client:
            for use_tools in (True, False) if tools else (False,):
                _raise_if_aborted(job_id)
                body = payload if use_tools else {k: v for k, v in payload.items() if k != "tools"}
                sink = _StreamGate(on_token, on_think)
                tool_acc: dict[int, dict[str, Any]] = {}
                files = _WriteFileStream(on_token)
                try:
                    async with client.stream(
                        "POST", f"{OLLAMA_BASE}/api/chat", json=body
                    ) as r:
                        if r.status_code >= 400:
                            err_body = (await r.aread()).decode("utf-8", "replace")
                            if "think" in body and r.status_code in {400, 422}:
                                body = {k: v for k, v in body.items() if k != "think"}
                                last = zen.ZenError(r.status_code, zen._friendly(r.status_code, err_body))
                                continue
                            err = zen.ZenError(r.status_code, zen._friendly(r.status_code, err_body))
                            last = err
                            if use_tools and r.status_code in {400, 404, 422}:
                                continue
                            raise err
                        async for line in r.aiter_lines():
                            _raise_if_aborted(job_id)
                            if not line:
                                continue
                            try:
                                chunk = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if chunk.get("error"):
                                err = str(chunk["error"])
                                if use_tools and is_tool_json_error(err):
                                    last = zen.ZenError(502, err[:400])
                                    tool_acc.clear()
                                    break
                                raise zen.ZenError(502, err[:400])
                            msg = chunk.get("message") or {}
                            piece = msg.get("content") or ""
                            reason = msg.get("thinking") or msg.get("reasoning") or ""
                            if reason:
                                sink.push_reason(reason)
                            if piece:
                                sink.push_content(piece)
                            if msg.get("tool_calls"):
                                for i, call in enumerate(msg["tool_calls"]):
                                    packed = {**call, "index": i}
                                    _merge_tool_delta(tool_acc, [packed])
                                    files.feed([packed])
                            await asyncio.sleep(0)
                except asyncio.CancelledError:
                    raise
                except httpx.TimeoutException:
                    if job_aborted(job_id):
                        raise asyncio.CancelledError
                    last = zen.ZenError(504, f"{backend} timed out")
                    continue
                except httpx.HTTPError as e:
                    if job_aborted(job_id):
                        raise asyncio.CancelledError from e
                    raise zen.ZenError(503, f"{backend} unreachable") from e
                if last and use_tools and is_tool_json_error(last.message):
                    continue
                return _packed_from_gate(sink, tool_acc)
    finally:
        _untrack_client(job_id, client)
    if last:
        if job_aborted(job_id):
            raise asyncio.CancelledError
        raise last
    return await openai_chat_stream(
        f"{OLLAMA_BASE}/v1",
        "ollama",
        backend,
        messages,
        tools=tools,
        timeout=timeout,
        on_token=on_token,
        on_think=on_think,
        job_id=job_id,
    )


def _spark_key_for(base: str) -> str:
    if _spark_v1(base) == _spark_v1(SPARK2_BASE):
        return SPARK2_KEY
    return SPARK_KEY


async def chat(
    model_id: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
    spark_base: str | None = None,
    job_id: str = "",
) -> dict[str, Any]:
    provider, backend = parse_model(model_id)
    payload = messages
    if messages_have_images(payload) and not model_accepts_images(model_id):
        payload = text_only_messages(payload)

    async def send(msgs: list[dict[str, Any]]) -> dict[str, Any]:
        _raise_if_aborted(job_id)
        if provider == "openrouter":
            if not OPENROUTER_KEY:
                raise zen.ZenError(401, "OPENROUTER_API_KEY is missing")
            extra = {
                "HTTP-Referer": "http://127.0.0.1:3000",
                "X-Title": "Personal Factory",
            }
            return await _openai_with_token_ladder(
                OPENROUTER_BASE,
                OPENROUTER_KEY,
                backend,
                msgs,
                tools=tools,
                timeout=300,
                token_steps=(65536, 32768),
                extra_headers=extra,
                on_token=on_token,
                on_think=on_think,
                job_id=job_id,
            )
        if provider == "local":
            if job_id:
                _local_backend[job_id] = backend
            return await ollama_chat_stream(
                backend,
                msgs,
                tools=tools,
                on_token=on_token,
                on_think=on_think,
                timeout=300,
                job_id=job_id,
            )
        if provider == "spark":
            base = spark_base or SPARK_BASE
            key = _spark_key_for(base)
            if not key:
                raise zen.ZenError(401, "SPARK_API_KEY is missing")
            return await _openai_with_token_ladder(
                base,
                key,
                backend,
                msgs,
                tools=tools,
                timeout=480,
                token_steps=(131072, 65536, 32768),
                extra_payload={"think": False, "reasoning_effort": "none"},
                on_token=on_token,
                on_think=on_think,
                job_id=job_id,
            )
        return await _openai_with_token_ladder(
            zen.BASE,
            zen.API_KEY,
            backend,
            msgs,
            tools=tools,
            timeout=240,
            token_steps=(65536, 32768),
            extra_headers={
                "Authorization": f"Bearer {zen.API_KEY}",
            },
            on_token=on_token,
            on_think=on_think,
            job_id=job_id,
        )

    try:
        return await send(payload)
    except asyncio.CancelledError:
        raise
    except zen.ZenError as e:
        if job_aborted(job_id):
            raise asyncio.CancelledError from e
        if messages_have_images(payload) and is_multimodal_reject(e.message):
            return await send(text_only_messages(payload))
        raise


async def complete_with_failover(
    preferred: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    on_caption: Caption | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
    job_id: str = "",
    agent_id: str = "",
) -> tuple[dict[str, Any], str]:
    await refresh_local()
    mid = (preferred or "").strip()
    if messages_have_images(messages) and not model_accepts_images(mid):
        vis = pick_vision_model({"model": mid})
        if vis and model_accepts_images(vis):
            mid = vis
    chain = failover_chain(mid)
    last_error: zen.ZenError | None = None
    for model_id in chain:
        _raise_if_aborted(job_id)
        provider, _backend = parse_model(model_id)
        label = label_for(model_id)
        if provider == "openrouter" and not openrouter_enabled():
            last_error = zen.ZenError(401, f"{label} needs an OpenRouter key in .env")
            continue
        if provider == "spark" and not spark_enabled():
            last_error = zen.ZenError(401, f"{label} needs SPARK_API_KEY in .env")
            continue
        gpu_held = False
        spark_box = ""
        cloud_held = False
        try:
            if provider == "local":
                if _gpu_lock.locked() and on_caption:
                    on_caption("Waiting for the local GPU…")
                await _gpu_lock.acquire()
                gpu_held = True
                if job_id:
                    import plant

                    plant.hold_local(job_id, agent_id, model_id)
                    _local_backend[job_id] = _backend
            if provider == "spark":
                claimed = await claim_spark_box()
                if not claimed:
                    if on_caption:
                        on_caption("Spark is busy — switching")
                    last_error = zen.ZenError(429, "Spark is busy")
                    continue
                spark_box = claimed
                if job_id:
                    import plant

                    plant.hold_spark(spark_box, job_id, agent_id)
            if provider in {"openrouter", "zen"} and job_id:
                import plant

                plant.hold_cloud(job_id, provider)
                cloud_held = True
            if on_caption:
                if spark_box and _spark_v1(spark_box) != _spark_v1(SPARK_BASE):
                    on_caption("Working on Spark 2")
                elif len(chain) > 1 and model_id != chain[0]:
                    on_caption(f"Working with {label}")
                else:
                    on_caption("Working")

            async def run(use_tools: list[dict[str, Any]] | None) -> dict[str, Any]:
                pulse_alive = True

                async def beat() -> None:
                    delay = 4.0 if provider == "spark" else 12.0
                    note = "Spark is thinking…" if provider == "spark" else "Still working…"
                    try:
                        while True:
                            await asyncio.sleep(delay)
                            if on_caption:
                                on_caption(note)
                            delay = min(delay + 4.0, 16.0)
                    except asyncio.CancelledError:
                        return

                def wrapped_token(delta: str) -> None:
                    nonlocal pulse_alive
                    if pulse_alive:
                        pulse_alive = False
                        pulse.cancel()
                        if on_caption:
                            on_caption("Writing")
                    if on_token:
                        on_token(delta)

                def wrapped_think(delta: str) -> None:
                    nonlocal pulse_alive
                    if pulse_alive:
                        pulse_alive = False
                        pulse.cancel()
                    if on_think:
                        on_think(delta)

                pulse = asyncio.create_task(beat())
                try:
                    return await chat(
                        model_id,
                        messages,
                        tools=use_tools,
                        on_token=wrapped_token,
                        on_think=wrapped_think,
                        spark_base=spark_box or None,
                        job_id=job_id,
                    )
                finally:
                    pulse.cancel()

            try:
                data = await run(tools)
            except asyncio.CancelledError:
                raise
            except zen.ZenError as e:
                if job_aborted(job_id):
                    raise asyncio.CancelledError from e
                if tools and is_tool_json_error(e.message):
                    try:
                        data = await run(None)
                    except asyncio.CancelledError:
                        raise
                    except zen.ZenError as again:
                        if job_aborted(job_id):
                            raise asyncio.CancelledError from again
                        last_error = again
                        if on_caption:
                            on_caption(f"{label} couldn’t run")
                        continue
                else:
                    last_error = e
                    if on_caption:
                        on_caption(f"{label} couldn’t run")
                    continue

            msg = ((data.get("choices") or [{}])[0].get("message") or {})
            if tools and not (msg.get("content") or "").strip() and not (msg.get("tool_calls") or []):
                try:
                    data = await run(None)
                except asyncio.CancelledError:
                    raise
                except zen.ZenError:
                    if job_aborted(job_id):
                        raise asyncio.CancelledError
                    pass
            return data, model_id
        finally:
            if gpu_held:
                _gpu_lock.release()
                if job_id:
                    import plant

                    plant.release_local(job_id)
                    _local_backend.pop(job_id, None)
            if spark_box:
                await release_spark_box(spark_box)
                if job_id:
                    import plant

                    plant.release_spark(spark_box)
            if cloud_held and job_id:
                import plant

                plant.release_cloud(job_id)
    raise last_error or zen.ZenError(502, "No model could run this job")


def _assemble(
    local_names: set[str],
    router_ok: bool,
    spark_names: set[str],
    zen_ok: bool,
) -> dict[str, Any]:
    catalog: list[dict[str, Any]] = []
    seen: set[str] = set()

    def push(row: dict[str, str], available: bool) -> None:
        if row["id"] in seen:
            return
        seen.add(row["id"])
        catalog.append(_entry(row, available))

    for row in LOCAL_PINNED:
        push(row, row["backend"] in local_names)
    for name in sorted(n for n in local_names if ":" in n):
        family = name.split(":")[0]
        if "embed" in name.lower() or family in {"bge-m3"}:
            continue
        if name in {r["backend"] for r in LOCAL_PINNED}:
            continue
        if family in {r["backend"].split(":")[0] for r in LOCAL_PINNED} and not family.endswith("-json"):
            continue
        push(
            {
                "id": f"local:{name}",
                "name": name,
                "provider": "local",
                "backend": name,
                "hint": "This machine · Ollama",
                "vram": "",
            },
            True,
        )
    for row in SPARK_PINNED:
        push(row, row["backend"] in spark_names)
    pinned_backends = {r["backend"] for r in SPARK_PINNED}
    for name in sorted(spark_names):
        if not _spark_chat_name(name) or name in pinned_backends:
            continue
        push(
            {
                "id": f"spark:{name}",
                "name": name,
                "provider": "spark",
                "backend": name,
                "hint": "Spark · LiteLLM",
                "vram": "",
            },
            True,
        )
    for row in OPENROUTER_PINNED:
        push(row, router_ok)
    for row in ZEN_PINNED:
        push(row, zen_ok)

    try:
        default = default_model_id()
    except Exception:
        default = "big-pickle"

    return {
        "catalog": catalog,
        "default": default,
        "openrouter": router_ok,
        "ollama": bool(local_names),
        "spark": bool(spark_names),
        "zen": zen_ok,
        "chat": [row["id"] for row in catalog if row["available"]],
        "models": [row["id"] for row in catalog],
    }


def fallback_snapshot() -> dict[str, Any]:
    """Pinned desks even when Ollama / Spark / OpenRouter probes fail."""
    return _assemble(_ollama_models, _openrouter_ok, _spark_models, bool(os.getenv("OPENCODE_API_KEY")))


async def snapshot() -> dict[str, Any]:
    try:
        now = time.monotonic()
        if _ollama_until <= now:
            await refresh_local()
        if _openrouter_until <= now:
            _spawn(refresh_openrouter())
        if _spark_until <= now:
            _spawn(refresh_spark())
        return fallback_snapshot()
    except Exception:
        return fallback_snapshot()
