"""Turn mermaid-ish flowcharts into draw.io (.drawio) XML."""

from __future__ import annotations

import html
import re
from typing import Any

_FENCE_START = re.compile(
    r"^(?:flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram)",
    re.M,
)
_NODE = re.compile(
    r"([A-Za-z][\w-]*)(?:\[([^\]]+)\]|\(([^)]+)\)|\{([^}]+)\})?"
)
_EDGE = re.compile(
    r"([A-Za-z][\w-]*)(?:\[[^\]]*\]|\([^)]*\)|\{[^}]*\})?"
    r"\s*(?:-->|---|==>)\s*"
    r"(?:\|([^|]*)\|\s*)?"
    r"([A-Za-z][\w-]*)"
)


def maybe_mermaid_source(text: str) -> str | None:
    blob = (text or "").strip()
    if not blob:
        return None
    m = _FENCE_START.search(blob)
    if not m:
        return None
    return blob[m.start() :].strip()


def looks_like_drawio(text: str) -> bool:
    low = (text or "").lstrip().lower()
    return low.startswith("<mxfile") or "<mxgraphmodel" in low


def mermaid_to_drawio(src: str) -> str:
    nodes, edges, direction = _parse_flowchart(src)
    if not nodes:
        return _mxfile(
            [
                {
                    "id": "n1",
                    "label": "Diagram",
                    "x": 80,
                    "y": 80,
                    "w": 180,
                    "h": 60,
                }
            ],
            [],
        )
    return _mxfile(*_layout(nodes, edges, direction))


def _parse_flowchart(src: str) -> tuple[dict[str, str], list[tuple[str, str, str]], str]:
    direction = "LR"
    first = (src or "").strip().splitlines()[:1]
    if first:
        head = first[0].lower()
        if re.search(r"\b(td|tb)\b", head):
            direction = "TD"
        elif "rl" in head:
            direction = "RL"
        elif "bt" in head:
            direction = "BT"
    labels: dict[str, str] = {}
    edges: list[tuple[str, str, str]] = []
    for raw in (src or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("%%") or line.startswith("flowchart") or line.startswith("graph "):
            continue
        line = line.rstrip(";")
        for match in _NODE.finditer(line):
            nid = match.group(1)
            label = next((g for g in match.groups()[1:] if g), None)
            if label:
                labels[nid] = label.strip()
        pos = 0
        while True:
            em = _EDGE.search(line, pos)
            if not em:
                break
            a, lab, b = em.group(1), (em.group(2) or "").strip(), em.group(3)
            labels.setdefault(a, a)
            labels.setdefault(b, b)
            edges.append((a, b, lab))
            pos = em.start(3)
    return labels, edges, direction


def _layout(
    labels: dict[str, str], edges: list[tuple[str, str, str]], direction: str
) -> tuple[list[dict[str, Any]], list[tuple[str, str, str]]]:
    ids = list(labels.keys())
    rank: dict[str, int] = {i: 0 for i in ids}
    for _ in range(len(ids) + 1):
        changed = False
        for a, b, _lab in edges:
            nxt = rank.get(a, 0) + 1
            if nxt > rank.get(b, 0):
                rank[b] = nxt
                changed = True
        if not changed:
            break
    buckets: dict[int, list[str]] = {}
    for nid in ids:
        buckets.setdefault(rank.get(nid, 0), []).append(nid)
    nodes: list[dict[str, Any]] = []
    w, h, gap_x, gap_y = 180, 64, 240, 120
    for r, group in sorted(buckets.items()):
        for i, nid in enumerate(group):
            if direction in {"TD", "TB"}:
                x, y = 80 + i * gap_x, 80 + r * gap_y
            elif direction == "RL":
                x, y = 80 + (max(rank.values() or [0]) - r) * gap_x, 80 + i * gap_y
            else:
                x, y = 80 + r * gap_x, 80 + i * gap_y
            nodes.append(
                {"id": nid, "label": labels[nid], "x": x, "y": y, "w": w, "h": h}
            )
    return nodes, edges


def _esc(text: str) -> str:
    return html.escape(text or "", quote=True)


def _mxfile(nodes: list[dict[str, Any]], edges: list[tuple[str, str, str]]) -> str:
    cells = [
        '<mxCell id="0"/>',
        '<mxCell id="1" parent="0"/>',
    ]
    style = (
        "rounded=1;whiteSpace=wrap;html=1;fillColor=#fff7ee;strokeColor=#1c1814;"
        "fontFamily=Helvetica;fontSize=14;"
    )
    for node in nodes:
        cells.append(
            f'<mxCell id="{_esc(node["id"])}" value="{_esc(str(node["label"]))}" '
            f'style="{style}" vertex="1" parent="1">'
            f'<mxGeometry x="{int(node["x"])}" y="{int(node["y"])}" '
            f'width="{int(node["w"])}" height="{int(node["h"])}" as="geometry"/>'
            f"</mxCell>"
        )
    for i, (src, dst, lab) in enumerate(edges, start=1):
        extra = f' value="{_esc(lab)}"' if lab else ""
        cells.append(
            f'<mxCell id="e{i}"{extra} style="endArrow=classic;html=1;rounded=0;" '
            f'edge="1" parent="1" source="{_esc(src)}" target="{_esc(dst)}">'
            f'<mxGeometry relative="1" as="geometry"/>'
            f"</mxCell>"
        )
    body = "\n        ".join(cells)
    return (
        '<mxfile host="foundry" type="device">\n'
        '  <diagram name="Page-1" id="page1">\n'
        '    <mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" '
        'tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
        'pageWidth="1600" pageHeight="900">\n'
        "      <root>\n"
        f"        {body}\n"
        "      </root>\n"
        "    </mxGraphModel>\n"
        "  </diagram>\n"
        "</mxfile>\n"
    )
