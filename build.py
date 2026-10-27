"""
Zen Laundry — static page builder (KINGSTECH)

Assembles the final .html pages from shared components so the header, footer,
<head> metadata and icons stay identical across every page.

    src/partials/head.html     shared <head> (title, meta, fonts, CSS)
    src/partials/header.html   shared header + navigation
    src/partials/footer.html   shared footer + scripts
    src/pages/*.html           page bodies, each starting with a <!--meta ... --> block

Usage:  python build.py
Output: one .html file per page in the project root (ready to upload).

Tokens available inside pages and partials:
    {{icon:name}}   inline SVG icon from ICONS below
    {{title}} {{description}} {{active:key}} etc. (see render())
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"

SVG_OPEN = ('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">')

ICONS = {
    "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "arrow-up": '<path d="M12 19V5M5 12l7-7 7 7"/>',
    "check": '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    "menu": '<path d="M4 6h16M4 12h16M4 18h16"/>',
    "close": '<path d="M6 6l12 12M18 6 6 18"/>',
    "phone": '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 '
             '19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 '
             '2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 '
             '2.81.7A2 2 0 0 1 22 16.92z"/>',
    "chat": '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/>',
    "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    "pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    "clock": '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "sparkles": '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
    "truck": '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/>'
             '<path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>'
             '<circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
    "shirt": '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 '
             '.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
    "building": '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01'
                'M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    "shield": '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'
             '<path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    "store": '<path d="M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>',
    "message": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "clipboard": '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6'
                 'a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
    "layers": '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
}


def icon(name: str) -> str:
    if name not in ICONS:
        raise KeyError(f"Unknown icon: {name}")
    return SVG_OPEN + ICONS[name] + "</svg>"


def parse_page(text: str):
    m = re.match(r"\s*<!--meta\s*(.*?)-->\s*", text, re.S)
    if not m:
        raise ValueError("Page is missing its <!--meta ... --> block")
    meta = {}
    for line in m.group(1).strip().splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            meta[key.strip()] = value.strip()
    return meta, text[m.end():]


def render(template: str, meta: dict) -> str:
    active = meta.get("active", "")

    def sub(match):
        token = match.group(1)
        if token.startswith("icon:"):
            return icon(token[5:])
        if token.startswith("active:"):
            return ' aria-current="page"' if token[7:] == active else ""
        if token in meta:
            return meta[token]
        raise KeyError(f"Unknown token {{{{{token}}}}}")

    return re.sub(r"\{\{\s*([\w:.-]+)\s*\}\}", sub, template)


def build():
    head = (SRC / "partials" / "head.html").read_text(encoding="utf-8")
    header = (SRC / "partials" / "header.html").read_text(encoding="utf-8")
    footer = (SRC / "partials" / "footer.html").read_text(encoding="utf-8")

    pages = sorted((SRC / "pages").glob("*.html"))
    for page in pages:
        meta, body = parse_page(page.read_text(encoding="utf-8"))
        meta.setdefault("og_title", meta["title"])
        meta.setdefault("robots", "index, follow")
        preload = meta.get("preload", "")
        meta["preload_tag"] = (
            f'<link rel="preload" as="image" href="assets/images/{preload}-800.webp" '
            f'imagesrcset="assets/images/{preload}-800.webp 800w, assets/images/{preload}-1400.webp 1400w" '
            f'imagesizes="(min-width: 900px) 50vw, 100vw" fetchpriority="high">'
            if preload else ""
        )
        html = render(head + header + body + footer, meta)
        out = ROOT / page.name
        out.write_text(html, encoding="utf-8", newline="\n")
        print(f"built {out.name}")


if __name__ == "__main__":
    build()
