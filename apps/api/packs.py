"""CSV and printable PDF packs for desk tool skills."""

from __future__ import annotations

import csv
import io
import re
from pathlib import Path

_HEADING = re.compile(r"^(#{1,3})\s+(.+)$")
_BULLET = re.compile(r"^\s*[-*•]\s+(.+)$")
_NUMBER = re.compile(r"^\s*\d+[.)]\s+(.+)$")
_FENCE = re.compile(r"^```")


def maybe_csv_source(text: str) -> str | None:
    blob = (text or "").strip()
    if not blob or blob.lstrip().startswith(("#", "flowchart", "graph ")):
        return None
    lines = [ln.rstrip() for ln in blob.replace("\r\n", "\n").split("\n") if ln.strip()]
    if len(lines) < 2:
        return None
    sample = lines[:12]
    delim = "," if sum(ln.count(",") for ln in sample) >= sum(ln.count("\t") for ln in sample) else "\t"
    if not all(delim in ln for ln in sample[: min(4, len(sample))]):
        return None
    rows = list(csv.reader(io.StringIO("\n".join(lines)), delimiter=delim))
    if len(rows) < 2 or max(len(r) for r in rows) < 2:
        return None
    if delim == "\t":
        buf = io.StringIO()
        csv.writer(buf, lineterminator="\n").writerows(rows)
        return buf.getvalue().strip()
    return "\n".join(lines).strip()


def maybe_pack_markdown(text: str) -> str | None:
    blob = (text or "").strip()
    if not blob:
        return None
    if blob.lstrip().startswith(("flowchart", "graph ", "<mxfile", "<!doctype", "<html")):
        return None
    lines = blob.splitlines()
    if not any(_HEADING.match(ln.strip()) for ln in lines[:8]):
        return None
    if len([ln for ln in lines if ln.strip()]) < 4:
        return None
    return blob


def markdown_to_pdf(markdown: str, title: str = "Pack") -> bytes:
    from fpdf import FPDF

    font, bold = _fonts()
    pdf = FPDF(format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_title(title[:80])
    pdf.add_page()
    if font:
        pdf.add_font("Pack", "", font)
        if bold:
            pdf.add_font("Pack", "B", bold)
        family, size_p, size_h1, size_h2 = "Pack", 11, 18, 14
    else:
        family, size_p, size_h1, size_h2 = "Helvetica", 11, 18, 14
    pdf.set_text_color(28, 24, 20)

    def write(text: str, size: float, style: str = "", h: float = 6) -> None:
        pdf.set_xy(pdf.l_margin, pdf.get_y())
        usable = pdf.w - pdf.l_margin - pdf.r_margin
        if usable < 10:
            pdf.add_page()
            pdf.set_xy(pdf.l_margin, pdf.get_y())
            usable = pdf.w - pdf.l_margin - pdf.r_margin
        pdf.set_font(family, style if style and (bold or family == "Helvetica") else "", size)
        pdf.multi_cell(usable, h, _pdf_text(text) or " ")

    in_fence = False
    for raw in (markdown or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        if _FENCE.match(line.strip()):
            in_fence = not in_fence
            continue
        if in_fence:
            write(line or " ", 9, h=5)
            continue
        heading = _HEADING.match(line.strip())
        if heading:
            level = len(heading.group(1))
            if pdf.get_y() > 22:
                pdf.ln(4)
            write(heading.group(2), size_h1 if level == 1 else size_h2, "B", 8 if level == 1 else 7)
            pdf.ln(1)
            continue
        bullet = _BULLET.match(line) or _NUMBER.match(line)
        if bullet:
            write(f"- {_pdf_text(bullet.group(1))}", size_p, h=6)
            continue
        if not line.strip():
            pdf.ln(2)
            continue
        write(_strip_md(line), size_p, h=6)
    return bytes(pdf.output())


def _fonts() -> tuple[str | None, str | None]:
    windir = Path("C:/Windows/Fonts")
    regular = windir / "segoeui.ttf"
    bold = windir / "segoeuib.ttf"
    if regular.is_file():
        return str(regular), str(bold) if bold.is_file() else None
    return None, None


def _strip_md(text: str) -> str:
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"__(.+?)__", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text


def _pdf_text(text: str) -> str:
    return (text or "").replace("\t", "  ")
