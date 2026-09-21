"""Which brains a bay can use: OpenRouter, local Ollama, OpenCode Zen."""

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

_ollama_models: set[str] = set()
_ollama_until = 0.0
_openrouter_ok = False
_openrouter_until = 0.0
# One Ollama generation at a time — a 4090 cannot hold two big local models.
_gpu_lock = asyncio.Lock()


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
    if raw.startswith("zen:"):
        return "zen", raw.split(":", 1)[1]
    if "/" in raw:
        return "openrouter", raw
    return "zen", raw or "big-pickle"


def known_ids() -> set[str]:
    ids = {row["id"] for row in LOCAL_PINNED + OPENROUTER_PINNED + ZEN_PINNED}
    ids.update(zen.CHAT_MODELS)
    return ids


def openrouter_enabled() -> bool:
    return bool(OPENROUTER_KEY)


def default_model_id() -> str:
    if openrouter_enabled():
        return OPENROUTER_PINNED[0]["id"]
    if _ollama_models:
        for row in LOCAL_PINNED:
            if row["backend"] in _ollama_models:
                return row["id"]
        return f"local:{next(iter(_ollama_models))}"
    return "big-pickle"


def label_for(model_id: str) -> str:
    raw = (model_id or "").strip()
    for row in LOCAL_PINNED + OPENROUTER_PINNED + ZEN_PINNED:
        if row["id"] == raw:
            return row["name"]
    provider, backend = parse_model(raw)
    if provider == "openrouter":
        return backend.split("/")[-1] or backend
    return backend or "the selected model"


def failover_chain(primary: str) -> list[str]:
    mid = (primary or "").strip() or default_model_id()
    return [mid]


def _openrouter_headers() -> dict[str, str]:
    if not OPENROUTER_KEY:
        raise zen.ZenError(401, "OPENROUTER_API_KEY is missing")
    return {
        "Authorization": f"Bearer {OPENROUTER_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://127.0.0.1:3000",
        "X-Title": "Personal Factory",
    }


async def refresh_local() -> set[str]:
    global _ollama_models, _ollama_until
    now = time.monotonic()
    if _ollama_until > now:
        return _ollama_models
    found: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=1.2) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            if r.status_code < 400:
                for item in r.json().get("models") or []:
                    name = item.get("name") or ""
                    if name:
                        found.add(name)
                        found.add(name.split(":")[0])
    except httpx.HTTPError:
        found = set()
    _ollama_models = found
    _ollama_until = now + (20 if found else 8)
    return found


async def refresh_openrouter() -> bool:
    global _openrouter_until, _openrouter_ok
    now = time.monotonic()
    if not OPENROUTER_KEY:
        _openrouter_ok = False
        return False
    if _openrouter_until > now:
        return _openrouter_ok
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(f"{OPENROUTER_BASE}/models", headers=_openrouter_headers())
            ok = r.status_code < 400
    except httpx.HTTPError:
        ok = False
    _openrouter_ok = ok
    _openrouter_until = now + (60 if ok else 12)
    return ok


async def openai_chat(
    base_url: str,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    timeout: float = 90,
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
        "messages": messages,
        "temperature": 0.3,
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
                self.args[idx] = self.args.get(idx, "") + str(raw)
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
            slot["function"]["arguments"] += args


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
        "messages": messages,
        "temperature": 0.3,
        "max_tokens": 4096,
        "stream": True,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    last: zen.ZenError | None = None
    timeout_cfg = httpx.Timeout(timeout, connect=12.0, read=timeout, write=30.0)
    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        for use_tools in (True, False) if tools else (False,):
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
                        await asyncio.sleep(0)
            except httpx.TimeoutException:
                last = zen.ZenError(504, f"{model} timed out")
                continue
            except httpx.HTTPError as e:
                raise zen.ZenError(503, f"{model} unreachable") from e
            return _packed_from_gate(sink, tool_acc)
    if last:
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
        item: dict[str, Any] = {
            "role": "tool" if role == "tool" else role,
            "content": m.get("content") or "",
        }
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
) -> dict[str, Any]:
    timeout_cfg = httpx.Timeout(timeout, connect=12.0, read=timeout, write=30.0)
    payload: dict[str, Any] = {
        "model": backend,
        "messages": _ollama_messages(messages),
        "stream": True,
        "think": False,
        "options": {"temperature": 0.3, "num_predict": 4096},
    }
    if tools:
        payload["tools"] = tools
    last: zen.ZenError | None = None
    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        for use_tools in (True, False) if tools else (False,):
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
            except httpx.TimeoutException:
                last = zen.ZenError(504, f"{backend} timed out")
                continue
            except httpx.HTTPError as e:
                raise zen.ZenError(503, f"{backend} unreachable") from e
            if last and use_tools and is_tool_json_error(last.message):
                continue
            return _packed_from_gate(sink, tool_acc)
    if last:
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
    )


async def chat(
    model_id: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
) -> dict[str, Any]:
    provider, backend = parse_model(model_id)
    if provider == "openrouter":
        if not OPENROUTER_KEY:
            raise zen.ZenError(401, "OPENROUTER_API_KEY is missing")
        extra = {
            "HTTP-Referer": "http://127.0.0.1:3000",
            "X-Title": "Personal Factory",
        }
        return await openai_chat_stream(
            OPENROUTER_BASE,
            OPENROUTER_KEY,
            backend,
            messages,
            tools=tools,
            timeout=120,
            extra_headers=extra,
            on_token=on_token,
            on_think=on_think,
        )
    if provider == "local":
        return await ollama_chat_stream(
            backend,
            messages,
            tools=tools,
            on_token=on_token,
            on_think=on_think,
            timeout=300,
        )
    return await openai_chat_stream(
        zen.BASE,
        zen.API_KEY,
        backend,
        messages,
        tools=tools,
        timeout=120,
        extra_headers={
            "Authorization": f"Bearer {zen.API_KEY}",
        },
        on_token=on_token,
        on_think=on_think,
    )


async def complete_with_failover(
    preferred: str,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None,
    on_caption: Caption | None = None,
    on_token: TokenCb | None = None,
    on_think: TokenCb | None = None,
) -> tuple[dict[str, Any], str]:
    await refresh_local()
    model_id = (preferred or "").strip() or default_model_id()
    provider, backend = parse_model(model_id)
    label = label_for(model_id)
    if provider == "openrouter" and not openrouter_enabled():
        raise zen.ZenError(401, f"{label} needs an OpenRouter key in .env")

    gpu_held = False
    if provider == "local":
        if _gpu_lock.locked() and on_caption:
            on_caption("Waiting for the local GPU…")
        await _gpu_lock.acquire()
        gpu_held = True

    try:
        if on_caption:
            on_caption("Working")

        async def run(use_tools: list[dict[str, Any]] | None) -> dict[str, Any]:
            pulse_alive = True

            async def beat() -> None:
                try:
                    await asyncio.sleep(12)
                    if on_caption:
                        on_caption("Still working…")
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
                )
            finally:
                pulse.cancel()

        try:
            data = await run(tools)
        except zen.ZenError as e:
            if tools and is_tool_json_error(e.message):
                try:
                    data = await run(None)
                except zen.ZenError:
                    if on_caption:
                        on_caption(f"{label} couldn’t run")
                    raise
            else:
                if on_caption:
                    on_caption(f"{label} couldn’t run")
                raise

        msg = ((data.get("choices") or [{}])[0].get("message") or {})
        if tools and not (msg.get("content") or "").strip() and not (msg.get("tool_calls") or []):
            try:
                data = await run(None)
            except zen.ZenError:
                pass
        return data, model_id
    finally:
        if gpu_held:
            _gpu_lock.release()


async def snapshot() -> dict[str, Any]:
    local_names = await refresh_local()
    router_ok = await refresh_openrouter()
    zen_ok = bool(os.getenv("OPENCODE_API_KEY"))
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
    for row in OPENROUTER_PINNED:
        push(row, router_ok)
    for row in ZEN_PINNED:
        push(row, zen_ok)

    return {
        "catalog": catalog,
        "default": default_model_id(),
        "openrouter": router_ok,
        "ollama": bool(local_names),
        "zen": zen_ok,
        "chat": [row["id"] for row in catalog if row["available"]],
        "models": [row["id"] for row in catalog],
    }
