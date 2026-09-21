"""Optional OpenAI-compatible routers: OmniRoute (:20128) and FreeLLMAPI (:3001)."""

from __future__ import annotations

import os
import time
from typing import Any

import httpx
from dotenv import load_dotenv

import zen

load_dotenv()

LLM_BASE_URL = (os.getenv("LLM_BASE_URL") or "").rstrip("/")
LLM_API_KEY = os.getenv("LLM_API_KEY") or "sk_omniroute"
LLM_MODEL = os.getenv("LLM_MODEL") or "auto"

CANDIDATES = [
    *( [LLM_BASE_URL] if LLM_BASE_URL else [] ),
    "http://127.0.0.1:20128/v1",  # OmniRoute
    "http://127.0.0.1:3001/v1",   # FreeLLMAPI
]

_down_until: dict[str, float] = {}


def _headers(key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _normalize_base(url: str) -> str:
    url = url.rstrip("/")
    if url.endswith("/v1"):
        return url
    return url + "/v1"


async def chat(
    messages: list[dict[str, Any]],
    base_url: str,
    model: str = LLM_MODEL,
    tools: list[dict[str, Any]] | None = None,
    api_key: str = LLM_API_KEY,
    timeout: float = 90,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.3,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{_normalize_base(base_url)}/chat/completions",
            headers=_headers(api_key),
            json=payload,
        )
        if r.status_code >= 400:
            raise zen.ZenError(r.status_code, zen._friendly(r.status_code, r.text))
        data = r.json()
        if not (data.get("choices") or [{}])[0].get("message"):
            raise zen.ZenError(502, "router returned no message")
        return data


async def _alive(base: str) -> bool:
    now = time.monotonic()
    until = _down_until.get(base, 0)
    if until > now:
        return False
    try:
        async with httpx.AsyncClient(timeout=0.6) as client:
            r = await client.get(
                f"{_normalize_base(base)}/models",
                headers=_headers(LLM_API_KEY),
            )
            if r.status_code < 500:
                return True
    except httpx.HTTPError:
        pass
    _down_until[base] = now + 20
    return False


async def try_local_router(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], str] | None:
    """Use OmniRoute / FreeLLMAPI if one is running on this machine."""
    seen: set[str] = set()
    for raw in CANDIDATES:
        base = _normalize_base(raw)
        if base in seen:
            continue
        seen.add(base)
        if not await _alive(base):
            continue
        try:
            data = await chat(messages, base_url=base, tools=tools)
            via = (data.get("model") or LLM_MODEL)
            return data, f"router:{via}"
        except zen.ZenError:
            _down_until[base] = time.monotonic() + 8
            continue
    return None


def configured() -> dict[str, Any]:
    return {
        "llm_base_url": LLM_BASE_URL or None,
        "omniroute": "http://127.0.0.1:20128/v1",
        "freellmapi": "http://127.0.0.1:3001/v1",
        "model": LLM_MODEL,
    }
