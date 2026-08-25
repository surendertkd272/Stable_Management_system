#!/usr/bin/env python3
"""
md2pdf — render the EquiCare RFI/spec markdown files to clean, vendor-ready PDFs.

No third-party packages: converts Markdown -> styled HTML, then uses headless
Chrome (already on this machine) to print HTML -> PDF.

Handles exactly the constructs our documents use: H1-H3, tables (with inline
bold/italic in cells), bullet and numbered lists, indented continuation lines,
horizontal rules, inline code, bold, italic — plus special rendering for
`**Reply:**` slots, which become ruled fill-in lines so a vendor can print the
PDF and write on it (or type under it).

Usage:
    python3 tools/md2pdf.py RFI_IMU.md [more.md ...]        # -> pdf/<name>.pdf
    python3 tools/md2pdf.py --all                           # all RFI_*.md
    python3 tools/md2pdf.py doc.md --out /tmp/doc.pdf
"""
import re
import sys
import html
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

CSS = """
@page { size: A4; margin: 16mm 15mm 18mm 15mm; }
/* Force a light document regardless of the viewer's OS/app theme. Without an
   explicit background the PDF is transparent and a dark-mode reader can render
   it as unreadable light-on-black. */
:root { color-scheme: only light; }
* { box-sizing: border-box; }
html, body { background: #ffffff; }
body {
  font: 10.5pt/1.55 -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: #1a1f24; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 {
  font-size: 19pt; line-height: 1.25; margin: 0 0 4pt; color: #0f1720;
  letter-spacing: -0.2pt;
}
h1 + p { margin-top: 0; }
h2 {
  font-size: 12.5pt; margin: 20pt 0 7pt; padding-bottom: 4pt; color: #0f1720;
  border-bottom: 1.2pt solid #d9dee3; page-break-after: avoid;
}
h3 {
  font-size: 10.8pt; margin: 14pt 0 5pt; color: #33556b;
  text-transform: uppercase; letter-spacing: 0.4pt; page-break-after: avoid;
}
p { margin: 0 0 7pt; }
strong { font-weight: 640; color: #0f1720; }
em { font-style: italic; }
code {
  font: 9.4pt "SF Mono", Menlo, Consolas, monospace;
  background: #eef1f4; padding: 0.5pt 3pt; border-radius: 2.5pt;
}
hr { border: 0; border-top: 1pt solid #e3e7eb; margin: 16pt 0; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin-bottom: 4pt; }
li > p { margin: 0 0 3pt; }

/* header meta block under the title */
.meta { margin: 0 0 6pt; font-size: 10pt; color: #47535e; }
.meta strong { color: #0f1720; }

/* tables — used for the hard-requirements blocks */
table {
  width: 100%; border-collapse: collapse; margin: 8pt 0 12pt;
  font-size: 9.6pt; page-break-inside: auto;
}
th {
  background: #f2f5f7; text-align: left; font-weight: 640; color: #0f1720;
  border: 0.8pt solid #cdd5db; padding: 6pt 7pt; vertical-align: top;
}
td { border: 0.8pt solid #dde3e8; padding: 6pt 7pt; vertical-align: top; }
tr { page-break-inside: avoid; }
td:first-child { white-space: nowrap; text-align: center; background: #fafbfc; }

/* fill-in reply slot */
.reply {
  margin: 3pt 0 11pt; padding: 7pt 9pt 9pt;
  background: #f7fafb; border-left: 2.4pt solid #7fa8bd; border-radius: 2pt;
  page-break-inside: avoid;
}
.reply .lbl {
  font-size: 8.6pt; font-weight: 650; letter-spacing: 0.5pt;
  text-transform: uppercase; color: #4a6b80; display: block; margin-bottom: 9pt;
}
.reply .rule { border-bottom: 0.6pt solid #c3ced6; height: 13pt; }
.reply .rule:last-child { border-bottom: 0; }

/* footer note in italics at the end of the doc */
.footnote { font-size: 9.4pt; color: #5a6772; font-style: italic; }
"""


# --------------------------------------------------------------------------- #
def inline(text: str) -> str:
    """Escape HTML, then apply inline markdown. Bold before italic (** vs *)."""
    t = html.escape(text, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"<em>\1</em>", t)
    return t


def reply_block(label: str, rules: int = 3) -> str:
    lab = re.sub(r"^\*\*(.+?):?\*\*:?$", r"\1", label.strip()).rstrip(":")
    return (f'<div class="reply"><span class="lbl">{html.escape(lab)}</span>'
            + '<div class="rule"></div>' * rules + "</div>")


def split_row(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def md_to_html(md: str, title: str) -> str:
    lines = md.split("\n")
    out: list[str] = []
    i, n = 0, len(lines)
    list_stack: list[str] = []   # 'ul' | 'ol'

    def close_lists():
        while list_stack:
            out.append(f"</{list_stack.pop()}>")

    while i < n:
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()

        # blank
        if not stripped:
            i += 1
            continue

        # --- table -------------------------------------------------------- #
        if stripped.startswith("|") and i + 1 < n and re.match(r"^\|[\s:|-]+\|$", lines[i + 1].strip()):
            close_lists()
            head = split_row(stripped)
            out.append("<table><thead><tr>" + "".join(f"<th>{inline(c)}</th>" for c in head)
                       + "</tr></thead><tbody>")
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                cells = split_row(lines[i].strip())
                out.append("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells) + "</tr>")
                i += 1
            out.append("</tbody></table>")
            continue

        # --- horizontal rule ---------------------------------------------- #
        if re.fullmatch(r"-{3,}", stripped):
            close_lists()
            out.append("<hr>")
            i += 1
            continue

        # --- headings ------------------------------------------------------ #
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            close_lists()
            lvl = min(len(m.group(1)), 3)
            out.append(f"<h{lvl}>{inline(m.group(2))}</h{lvl}>")
            i += 1
            continue

        # --- reply slot (may be indented under a list item) ---------------- #
        if stripped.startswith("**Reply"):
            close_lists()
            out.append(reply_block(stripped))
            i += 1
            continue

        # --- lists --------------------------------------------------------- #
        mb = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        mo = re.match(r"^(\s*)(\d+)\.\s+(.*)$", line)
        if mb or mo:
            kind = "ul" if mb else "ol"
            body = mb.group(2) if mb else mo.group(3)
            if not list_stack or list_stack[-1] != kind:
                close_lists()
                start = f' start="{mo.group(2)}"' if mo and mo.group(2) != "1" else ""
                out.append(f"<{kind}{start}>")
                list_stack.append(kind)
            # gather indented continuation lines (but not a Reply slot)
            parts = [body]
            j = i + 1
            while j < n:
                nxt = lines[j]
                if not nxt.strip():
                    break
                if re.match(r"^\s*([-*]|\d+\.)\s", nxt) or nxt.strip().startswith("**Reply") \
                   or nxt.strip().startswith("#") or nxt.strip().startswith("|"):
                    break
                if nxt.startswith((" ", "\t")):
                    parts.append(nxt.strip())
                    j += 1
                else:
                    break
            out.append(f"<li>{inline(' '.join(parts))}</li>")
            i = j
            continue

        # --- paragraph (footer note if fully italic) ------------------------ #
        close_lists()
        para = [stripped]
        j = i + 1
        while j < n and lines[j].strip() and not re.match(
                r"^(\s*([-*]|\d+\.)\s|#{1,6}\s|\||-{3,}$|\*\*Reply)", lines[j].strip()):
            para.append(lines[j].strip())
            j += 1
        # Join continuation lines FIRST (so bold/italic spanning a soft line break
        # still matches), marking hard breaks with a sentinel that survives
        # escaping. A break is kept before a bold label line — e.g. the
        # To:/From:/Covers header block — so those don't run together.
        BR = "\x00"
        joined = para[0]
        for part in para[1:]:
            joined += (BR if part.startswith("**") else " ") + part
        text = inline(joined).replace(BR, "<br>")
        cls = ""
        if para[0].startswith("*") and para[-1].endswith("*") and not para[0].startswith("**"):
            cls = ' class="footnote"'
        elif para[0].startswith(("**To:**", "**From:**", "**Covers")):
            cls = ' class="meta"'
        out.append(f"<p{cls}>{text}</p>")
        i = j

    close_lists()
    return (f"<!doctype html><html><head><meta charset='utf-8'>"
            f"<title>{html.escape(title)}</title><style>{CSS}</style></head>"
            f"<body>{''.join(out)}</body></html>")


# --------------------------------------------------------------------------- #
def render(md_path: Path, out_pdf: Path) -> bool:
    if not Path(CHROME).exists():
        sys.exit(f"Google Chrome not found at {CHROME} — needed for PDF output.")
    md = md_path.read_text(encoding="utf-8")
    title = md_path.stem.replace("_", " ")
    out_pdf.parent.mkdir(parents=True, exist_ok=True)   # must exist before the temp file
    tmp_html = out_pdf.with_suffix(".tmp.html")
    tmp_html.write_text(md_to_html(md, title), encoding="utf-8")
    proc = subprocess.run(
        [CHROME, "--headless", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={out_pdf}", "--virtual-time-budget=2000",
         tmp_html.resolve().as_uri()],
        capture_output=True, text=True, timeout=90)
    tmp_html.unlink(missing_ok=True)
    if not out_pdf.exists() or out_pdf.stat().st_size == 0:
        print(proc.stderr[-800:], file=sys.stderr)
        return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", help="markdown files")
    ap.add_argument("--all", action="store_true", help="convert all RFI_*.md in repo root")
    ap.add_argument("--out", help="output path (single input only)")
    a = ap.parse_args()

    srcs = [Path(f) for f in a.files]
    if a.all:
        srcs = sorted(p for p in ROOT.glob("RFI_*.md"))
    if not srcs:
        ap.error("give markdown file(s) or --all")

    ok = True
    for s in srcs:
        if not s.exists():
            print(f"  ✗ {s} not found"); ok = False; continue
        dest = Path(a.out) if (a.out and len(srcs) == 1) else ROOT / "pdf" / f"{s.stem}.pdf"
        if render(s, dest):
            kb = dest.stat().st_size / 1024
            print(f"  ✓ {s.name:26} -> {dest.relative_to(ROOT) if ROOT in dest.parents else dest}  ({kb:.0f} KB)")
        else:
            print(f"  ✗ {s.name}: PDF generation failed"); ok = False
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
