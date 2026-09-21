"""OpenCode Zen client, plus a public fallback so jobs can still finish."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

load_dotenv()

BASE = os.getenv("OPENCODE_BASE_URL", "https://opencode.ai/zen/v1").rstrip("/")
API_KEY = os.getenv("OPENCODE_API_KEY", "")
POLLINATIONS = os.getenv(
    "POLLINATIONS_URL", "https://text.pollinations.ai/openai"
)

# Chat/completions models that Zen actually serves to API keys.
# Nemotron *-free ids return FreeTierError outside the OpenCode app.
CHAT_MODELS = [
    "big-pickle",
    "mimo-v2.5-free",
    "ling-3.0-flash-fin-free",
]


class ZenError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message

    @property
    def is_rate_limit(self) -> bool:
        blob = f"{self.status} {self.message}".lower()
        return self.status == 429 or "freeusagelimiterror" in blob or "rate limit" in blob

    @property
    def is_credits(self) -> bool:
        blob = f"{self.status} {self.message}".lower()
        return any(
            token in blob
            for token in (
                "creditserror",
                "payment method",
                "insufficient credit",
            )
        ) or self.status == 402

    @property
    def is_free_tier(self) -> bool:
        return "freetiererror" in f"{self.status} {self.message}".lower()

    @property
    def is_billing(self) -> bool:
        return self.is_credits


def _friendly(status: int, body: str) -> str:
    try:
        data = json.loads(body)
        err = data.get("error", data)
        if isinstance(err, dict):
            inner = err.get("error", err)
            if isinstance(inner, dict) and inner.get("message"):
                return str(inner["message"])
            if err.get("message"):
                return str(err["message"])
    except Exception:
        pass
    return body[:400] or f"Zen HTTP {status}"


def headers() -> dict[str, str]:
    if not API_KEY:
        raise ZenError(401, "OPENCODE_API_KEY is missing")
    return {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    }


def _plain_messages(messages: list[dict[str, Any]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role") or "user"
        content = m.get("content")
        if content is None:
            calls = m.get("tool_calls") or []
            names = [((c.get("function") or {}).get("name") or "?") for c in calls]
            content = f"(requested tools: {', '.join(names)})"
        if role == "tool":
            out.append({"role": "user", "content": f"TOOL RESULT:\n{content}"})
        elif role in {"system", "user", "assistant"}:
            out.append({"role": role, "content": str(content)})
        else:
            out.append({"role": "user", "content": str(content)})
    return out


async def list_models() -> list[str]:
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(f"{BASE}/models", headers=headers())
        if r.status_code >= 400:
            raise ZenError(r.status_code, _friendly(r.status_code, r.text))
        data = r.json()
        ids = [m.get("id") for m in data.get("data", []) if m.get("id")]
        return ids


def _promote_reasoning(data: dict[str, Any]) -> None:
    """Some free Zen models put the answer in reasoning and leave content empty."""
    choices = data.get("choices") or []
    if not choices:
        return
    msg = choices[0].get("message") or {}
    content = msg.get("content")
    if isinstance(content, list):
        content = "".join(
            part if isinstance(part, str) else str(part.get("text") or "")
            for part in content
        )
        msg["content"] = content
        choices[0]["message"] = msg
    if isinstance(content, str) and content.strip():
        return
    reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
    if isinstance(reasoning, list):
        reasoning = "".join(
            part.get("text") or "" for part in reasoning if isinstance(part, dict)
        )
    if isinstance(reasoning, str) and reasoning.strip():
        msg["content"] = reasoning.strip()
        choices[0]["message"] = msg


async def chat(
    messages: list[dict[str, Any]],
    model: str,
    tools: list[dict[str, Any]] | None = None,
    temperature: float = 0.3,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = "auto"
    last: ZenError | None = None
    delays = (0.0, 3.0)
    async with httpx.AsyncClient(timeout=50) as client:
        for i, delay in enumerate(delays):
            if delay:
                await asyncio.sleep(delay)
            try:
                r = await client.post(
                    f"{BASE}/chat/completions",
                    headers=headers(),
                    json=payload,
                )
            except httpx.TimeoutException:
                last = ZenError(504, f"{model} timed out")
                if tools:
                    return await chat(messages, model, tools=None, temperature=temperature)
                if i < len(delays) - 1:
                    continue
                raise last
            if r.status_code < 400:
                data = r.json()
                _promote_reasoning(data)
                return data
            err = ZenError(r.status_code, _friendly(r.status_code, r.text))
            last = err
            if err.is_free_tier:
                raise err
            if tools and r.status_code in {400, 404, 422}:
                return await chat(messages, model, tools=None, temperature=temperature)
            if err.is_rate_limit and i < len(delays) - 1:
                continue
            raise err
    raise last or ZenError(502, "Zen returned no response")


async def responses(messages: list[dict[str, Any]], model: str) -> dict[str, Any]:
    """Zen /responses path used by some contributor-free models."""
    last = ""
    for m in reversed(messages):
        if m.get("role") == "user" and m.get("content"):
            last = str(m["content"])
            break
    payload = {"model": model, "input": last or "Reply briefly."}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{BASE}/responses",
            headers=headers(),
            json=payload,
        )
        if r.status_code >= 400:
            raise ZenError(r.status_code, _friendly(r.status_code, r.text))
        data = r.json()
        text = data.get("output_text") or ""
        if not text:
            for item in data.get("output") or []:
                for part in item.get("content") or []:
                    if part.get("text"):
                        text += part["text"]
        return {
            "choices": [{"message": {"role": "assistant", "content": text}}],
            "model": model,
        }


async def pollinations_chat(messages: list[dict[str, Any]]) -> dict[str, Any]:
    payload = {
        "model": "openai",
        "messages": _plain_messages(messages),
        "temperature": 0.3,
    }
    async with httpx.AsyncClient(timeout=75) as client:
        r = await client.post(
            POLLINATIONS,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json=payload,
        )
        if r.status_code >= 400:
            last_user = next(
                (m["content"] for m in reversed(payload["messages"]) if m["role"] == "user"),
                "Reply briefly.",
            )
            g = await client.get("https://text.pollinations.ai/" + quote(last_user[:400], safe=""))
            if g.status_code >= 400:
                raise ZenError(
                    r.status_code, _friendly(r.status_code, r.text) or "backup model failed"
                )
            return {
                "choices": [{"message": {"role": "assistant", "content": g.text}}],
                "model": "backup",
            }
        data = r.json()
        if not (data.get("choices") or [{}])[0].get("message"):
            text = data.get("content") or data.get("text") or json.dumps(data)[:2000]
            return {"choices": [{"message": {"role": "assistant", "content": text}}], "model": "backup"}
        return data


async def complete(
    messages: list[dict[str, Any]],
    model: str,
    tools: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], str]:
    """Try Zen, then a key-free backup. Returns (payload, model_id)."""
    try:
        return await chat(messages, model=model, tools=tools), model
    except ZenError:
        data = await pollinations_chat(messages)
        return data, "backup"
