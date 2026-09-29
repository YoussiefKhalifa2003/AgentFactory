"""One paper-light deck template. Models write sections; the harness owns the look."""

from __future__ import annotations

import re
from html import escape

MARKER = "<!-- workspace-deck -->"
_STYLE = re.compile(r"<style\b[^>]*>.*?</style>", re.I | re.S)
_SCRIPT = re.compile(r"<script\b[^>]*>.*?</script>", re.I | re.S)
_SECTION = re.compile(r"<section\b([^>]*)>(.*?)</section>", re.I | re.S)
_BODY = re.compile(r"<body\b[^>]*>(.*?)</body>", re.I | re.S)
_CHROME = re.compile(r"</?(?:html|head|body|!doctype)[^>]*>", re.I)
_CLASS = re.compile(r'class\s*=\s*["\']([^"\']+)["\']', re.I)

CSS = """
:root {
  --paper: #f7f3ea;
  --ink: #1c1814;
  --soft: #5e574e;
  --line: rgba(28, 24, 20, 0.12);
  --bar: #1c1814;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100%;
  background: var(--paper);
  color: var(--ink);
}
body {
  font-family: ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  overflow: hidden;
}
.progress {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--line);
  z-index: 4;
}
.progress > span {
  display: block;
  height: 100%;
  width: 0;
  background: var(--bar);
  transition: width .25s ease;
}
.deck {
  height: 100vh;
  width: 100vw;
}
.slide {
  display: none;
  position: relative;
  height: 100vh;
  width: 100vw;
  padding: 10vh 8vw 12vh;
  overflow: hidden;
}
.slide::before {
  content: "";
  position: absolute;
  top: 0; left: 0; bottom: 0;
  width: 7px;
  background: var(--bar);
}
.slide.on { display: flex; flex-direction: column; justify-content: center; }
.slide h1, .slide h2 {
  font-family: Georgia, "Times New Roman", serif;
  font-weight: 500;
  letter-spacing: -0.03em;
  margin: 0 0 .4em;
  line-height: 1.12;
}
.slide h1 { font-size: clamp(2.4rem, 6.4vw, 5.4rem); max-width: 16ch; }
.slide h2 { font-size: clamp(1.7rem, 3.6vw, 3rem); max-width: 22ch; }
.slide p, .slide li {
  font-size: clamp(1.05rem, 1.7vw, 1.45rem);
  line-height: 1.45;
  color: var(--ink);
}
.slide p { max-width: 42rem; margin: 0 0 .75em; }
.kicker, .attrib {
  font-size: .78rem;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: var(--soft);
  margin: 0 0 1.1em;
}
.slide ul {
  margin: .4em 0 0;
  padding: 0;
  list-style: none;
  max-width: 38rem;
}
.slide li {
  position: relative;
  padding: .42em 0 .42em 1.15em;
  border-top: 1px solid var(--line);
}
.slide li:first-child { border-top: 0; }
.slide li::before {
  content: "";
  position: absolute;
  left: 0; top: 1.05em;
  width: .45em; height: .45em;
  border-radius: 50%;
  background: var(--bar);
}
.slide li strong { font-weight: 600; }
.slide.title { justify-content: flex-end; padding-bottom: 16vh; }
.slide.title h1 { margin-bottom: .25em; }
.slide.quote { justify-content: center; }
.slide.quote blockquote {
  margin: 0;
  max-width: 18em;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.6rem, 3.2vw, 2.6rem);
  line-height: 1.28;
  font-style: italic;
}
.slide.end { text-align: center; align-items: center; }
.slide.end h1, .slide.end p { text-align: center; }
.counter {
  position: fixed;
  right: 8vw;
  bottom: 4.5vh;
  font-size: .78rem;
  letter-spacing: .16em;
  color: var(--soft);
  z-index: 4;
}
""".strip()

JS = """
(function () {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const bar = document.querySelector(".progress > span");
  const counter = document.querySelector(".counter");
  let i = 0;
  function go(n) {
    if (!slides.length) return;
    i = (n + slides.length) % slides.length;
    slides.forEach((el, idx) => el.classList.toggle("on", idx === i));
    if (bar) bar.style.width = ((i + 1) / slides.length * 100) + "%";
    if (counter) {
      const cur = String(i + 1).padStart(2, "0");
      const tot = String(slides.length).padStart(2, "0");
      counter.textContent = cur + " / " + tot;
    }
    if (history.replaceState) history.replaceState(null, "", "#s" + (i + 1));
  }
  function fromHash() {
    const m = (location.hash || "").match(/^#s(\\d+)/i);
    return m ? parseInt(m[1], 10) - 1 : 0;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
      e.preventDefault();
      go(i + 1);
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      e.preventDefault();
      go(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(0);
    } else if (e.key === "End") {
      e.preventDefault();
      go(slides.length - 1);
    }
  });
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("a")) return;
    go(i + 1);
  });
  go(fromHash());
})();
""".strip()


def _strip_chrome(html: str) -> str:
    blob = _STYLE.sub("", html or "")
    blob = _SCRIPT.sub("", blob)
    return blob


def _class_list(attrs: str) -> list[str]:
    match = _CLASS.search(attrs or "")
    return match.group(1).split() if match else []


def _typed_class(index: int, _total: int, attrs: str, inner: str) -> str:
    classes = _class_list(attrs)
    if "slide" not in classes:
        classes.insert(0, "slide")
    kinds = {"title", "quote", "end"}
    if not kinds.intersection(classes):
        if index == 0 and re.search(r"<h1\b", inner or "", re.I):
            classes.append("title")
    seen: list[str] = []
    for name in classes:
        if name not in seen:
            seen.append(name)
    return " ".join(seen)


def _inner_sections(html: str) -> list[tuple[str, str]]:
    blob = _strip_chrome(html)
    found = _SECTION.findall(blob)
    if found:
        return [(attrs, inner.strip()) for attrs, inner in found if inner.strip()]
    body = _BODY.search(blob)
    rest = body.group(1) if body else blob
    rest = _CHROME.sub("", rest).strip()
    if not rest:
        return [("", "<h1>Deck</h1>")]
    return [("", rest)]


def wrap_deck(html: str) -> str:
    parts = _inner_sections(html or "")
    n = len(parts)
    slides = []
    for i, (attrs, inner) in enumerate(parts):
        klass = _typed_class(i, n, attrs, inner)
        slides.append(f'<section class="{klass}">{inner}</section>')
    title_match = re.search(r"<h1\b[^>]*>(.*?)</h1>", parts[0][1], re.I | re.S)
    title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else "Deck"
    body = "\n".join(slides)
    return (
        "<!DOCTYPE html>\n"
        f"<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\"/>\n"
        f"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n"
        f"<title>{escape(title) or 'Deck'}</title>\n"
        f"{MARKER}\n<style>\n{CSS}\n</style>\n</head>\n<body>\n"
        f'<div class="progress" aria-hidden="true"><span></span></div>\n'
        f'<main class="deck">\n{body}\n</main>\n'
        f'<p class="counter"></p>\n'
        f"<script>\n{JS}\n</script>\n</body>\n</html>\n"
    )
