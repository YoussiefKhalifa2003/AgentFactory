"""Factory multiplayer relay. Browser-to-factory only — never from the sandbox."""

from __future__ import annotations

from typing import Any

from fastapi import WebSocket

GAME_MSG_CAP = 8 * 1024
GAME_MAX_CLIENTS = 4


def message_ok(raw: str | bytes) -> bool:
    if isinstance(raw, bytes):
        return len(raw) <= GAME_MSG_CAP
    return len((raw or "").encode("utf-8")) <= GAME_MSG_CAP


class GameHub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}

    def count(self, job_id: str) -> int:
        return len(self.rooms.get(job_id) or ())

    def full(self, job_id: str) -> bool:
        return self.count(job_id) >= GAME_MAX_CLIENTS

    def add(self, job_id: str, ws: WebSocket) -> None:
        self.rooms.setdefault(job_id, set()).add(ws)

    def discard(self, job_id: str, ws: WebSocket) -> None:
        room = self.rooms.get(job_id)
        if not room:
            return
        room.discard(ws)
        if not room:
            self.rooms.pop(job_id, None)

    async def broadcast(self, job_id: str, raw: str, sender: WebSocket) -> None:
        room = list(self.rooms.get(job_id) or ())
        for peer in room:
            if peer is sender:
                continue
            try:
                await peer.send_text(raw)
            except Exception:
                self.discard(job_id, peer)


hub = GameHub()


def shim_script(job_id: str) -> str:
    safe = "".join(ch for ch in job_id if ch.isalnum() or ch in "-_")
    return (
        "<script id=\"foundry-game-ws\">"
        "window.FOUNDRY_GAME_WS=(function(){"
        "var p=location.protocol===\"https:\"?\"wss:\":\"ws:\";"
        f'return p+"//"+location.host+"/api/games/{safe}/ws";'
        "})();</script>\n"
    )


def token_from_ws(ws: WebSocket) -> str:
    header = ws.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return (ws.query_params.get("token") or "").strip()
