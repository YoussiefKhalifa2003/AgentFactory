"""Deterministic AgentLook defaults from a name hash."""

from __future__ import annotations

from typing import Any

BODIES = ["slim", "regular", "broad"]
HEADS = ["round", "oval", "square"]
SKINS = ["#f6d0b0", "#f0c4a0", "#e8b896", "#d9a07e", "#f3dcc8", "#e2b089", "#d4ae8c", "#f0d5c0"]
HAIRS = ["short", "wavy", "bun", "undercut", "long", "fade", "curly", "none"]
HAIR_COLORS = ["#c47a4a", "#8b5a32", "#d4a017", "#6b4a8a", "#c45c2c", "#d8b48a", "#5c7a62", "#4a6b8a"]
EYES = ["round", "almond", "narrow", "wide", "sleepy"]
BROWS = ["straight", "arch", "thick"]
MOUTHS = ["smile", "neutral", "smirk"]
OUTFITS = ["hoodie", "blazer", "apron", "lab", "cardigan", "tee"]
ACCESSORIES = ["none", "glasses", "headphones", "cap", "scarf"]


def _hash(name: str) -> int:
    h = 2166136261
    for ch in (name or "agent").lower():
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def look_from_name(name: str, pigment: str | None = None) -> dict[str, str]:
    h = _hash(name)
    hair_color = pigment or HAIR_COLORS[(h >> 9) % len(HAIR_COLORS)]
    return {
        "body": BODIES[h % len(BODIES)],
        "head": HEADS[(h >> 3) % len(HEADS)],
        "skin": SKINS[(h >> 5) % len(SKINS)],
        "hair": HAIRS[(h >> 7) % len(HAIRS)],
        "hairColor": hair_color,
        "eyes": EYES[(h >> 11) % len(EYES)],
        "brows": BROWS[(h >> 13) % len(BROWS)],
        "mouth": MOUTHS[(h >> 15) % len(MOUTHS)],
        "outfit": OUTFITS[(h >> 17) % len(OUTFITS)],
        "accessory": ACCESSORIES[(h >> 19) % len(ACCESSORIES)],
    }


def parse_look(raw: Any, name: str = "agent", pigment: str | None = None) -> dict[str, str]:
    fallback = look_from_name(name, pigment)
    if not isinstance(raw, dict):
        return fallback
    out = dict(fallback)
    for key, allowed in (
        ("body", BODIES),
        ("head", HEADS),
        ("hair", HAIRS),
        ("eyes", EYES),
        ("brows", BROWS),
        ("mouth", MOUTHS),
        ("outfit", OUTFITS),
        ("accessory", ACCESSORIES),
    ):
        val = raw.get(key)
        if isinstance(val, str) and val in allowed:
            out[key] = val
    for key in ("skin", "hairColor"):
        val = raw.get(key)
        if isinstance(val, str) and val.startswith("#") and 4 <= len(val) <= 9:
            out[key] = val
    return out
