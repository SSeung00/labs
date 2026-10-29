"""Editor document model shared by the readers and the HWPX writer.

The editor (TipTap / ProseMirror) works on *resolved* formatting: every run carries its font,
size and colour instead of an ID into a shape table. Readers resolve HWP's char/para shape
tables into these attributes; the writer de-duplicates them back into HWPX property lists.

Units: pt everywhere (1 pt = 100 HWPUNIT), except table `colwidth` which is px (TipTap's own
convention, 96 dpi: 1 pt = 4/3 px).

Document JSON:
{
  "page": {width, height, left, right, top, bottom, header, footer, landscape},
  "header": [paragraph...] | None, "footer": [...] | None,
  "pageNumber": {"pos": "BOTTOM_CENTER", "side": "-"} | None,
  "content": {"type": "doc", "content": [paragraph | table ...]}
}

Nodes
  paragraph  attrs: align, left, right, indent, before, after, lineType, line, pageBreak,
             keepWord (break Korean only between words, 어절 단위),
             size (pt of the paragraph's first run; gives empty paragraphs their line height),
             hf (['header', 'footer']: the header/footer control sits here; it applies from this
                 paragraph's page on)
  table      attrs: width, align ('left'|'center'|'right', from the anchor paragraph), float
             content: tableRow+
  tableRow   attrs: height
  tableCell  attrs: colspan, rowspan, colwidth[px], background, borders, vAlign, padding
  image      (inline) attrs: src, width, height, alt, float

float (objects not "treated as a character"; None otherwise):
  {wrap: SQUARE|TOP_AND_BOTTOM|BEHIND_TEXT|IN_FRONT_OF_TEXT, vertRelTo: PAPER|PAGE|PARA,
   horzRelTo: PAPER|PAGE|COLUMN|PARA, vertAlign: TOP|CENTER|BOTTOM|INSIDE|OUTSIDE,
   horzAlign: LEFT|CENTER|RIGHT|INSIDE|OUTSIDE, vertOffset, horzOffset, width, height (pt),
   z (z-order), hidden (fully covered by a later object at the same place)}
  equation   (inline) attrs: script, width, height, size, color
  footnote   (inline) attrs: kind ('foot'|'end'), content [paragraph...]
  hardBreak, text
Marks
  textStyle  attrs: fontLatin, fontHangul, size, color, shade, spacing, ratio
  bold, italic, underline (attrs: type 'bottom'|'top'), strike, superscript, subscript
"""

from __future__ import annotations

PT = 100  # HWPUNIT per pt
PX_PER_PT = 4 / 3

DEFAULT_FONT = "함초롬바탕"

ALIGNS = ["justify", "left", "right", "center", "distribute", "distribute_space"]
HWPX_ALIGN = {
    "justify": "JUSTIFY", "left": "LEFT", "right": "RIGHT", "center": "CENTER",
    "distribute": "DISTRIBUTE", "distribute_space": "DISTRIBUTE_SPACE",
}
LINE_TYPES = ["percent", "fixed", "between", "atleast"]
HWPX_LINE_TYPE = {"percent": "PERCENT", "fixed": "FIXED", "between": "BETWEEN_LINES", "atleast": "AT_LEAST"}

# HWP 5.0 border line types (표 26) in file order, named as in OWPML.
BORDER_TYPES = [
    "NONE", "SOLID", "DASH", "DOT", "DASH_DOT", "DASH_DOT_DOT", "LONG_DASH", "CIRCLE",
    "DOUBLE_SLIM", "SLIM_THICK", "THICK_SLIM", "SLIM_THICK_SLIM", "WAVE", "DOUBLE_WAVE",
    "THICK_3D", "THICK_3D_REVERS_LIGHTING", "3D", "3D_REVERS_LIGHTING",
]
# HWP 5.0 border widths (표 27), mm.
BORDER_WIDTHS = [0.1, 0.12, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0]


def rnd(v: float, nd: int = 2) -> float:
    r = round(v, nd)
    return int(r) if r == int(r) else r


def pt(hwpunit: float) -> float:
    return rnd(hwpunit / PT)


def px(hwpunit: float) -> int:
    return max(1, round(hwpunit / PT * PX_PER_PT))


def default_page() -> dict:
    """A4 portrait with Hangul's default margins."""
    return {
        "width": 595.28, "height": 841.89,
        "left": 85.04, "right": 85.04, "top": 56.69, "bottom": 42.52,
        "header": 42.52, "footer": 42.52, "landscape": False,
    }


def default_para_attrs() -> dict:
    return {
        "align": "justify", "left": 0, "right": 0, "indent": 0, "before": 0, "after": 0,
        "lineType": "percent", "line": 160, "pageBreak": False, "keepWord": False,
        "size": None, "hf": None,
    }


def default_char() -> dict:
    return {
        "fontHangul": DEFAULT_FONT, "fontLatin": DEFAULT_FONT, "size": 10, "color": "#000000",
        "shade": None, "spacing": 0, "ratio": 100,
        "bold": False, "italic": False, "underline": None, "strike": False,
        "superscript": False, "subscript": False,
    }


def marks_for(cs: dict) -> list[dict]:
    """Resolved char shape -> TipTap marks."""
    style = {
        "fontHangul": cs.get("fontHangul") or DEFAULT_FONT,
        "fontLatin": cs.get("fontLatin") or cs.get("fontHangul") or DEFAULT_FONT,
        "size": cs.get("size", 10),
        "color": cs.get("color") or "#000000",
        "shade": cs.get("shade"),
        "spacing": cs.get("spacing", 0),
        "ratio": cs.get("ratio", 100),
    }
    marks = [{"type": "textStyle", "attrs": style}]
    if cs.get("bold"):
        marks.append({"type": "bold"})
    if cs.get("italic"):
        marks.append({"type": "italic"})
    if cs.get("underline"):
        marks.append({"type": "underline", "attrs": {"type": cs["underline"]}})
    if cs.get("strike"):
        marks.append({"type": "strike"})
    if cs.get("superscript"):
        marks.append({"type": "superscript"})
    elif cs.get("subscript"):
        marks.append({"type": "subscript"})
    return marks


class InlineBuilder:
    """Collects a paragraph's inline content, merging adjacent text with the same marks."""

    def __init__(self):
        self.nodes: list[dict] = []
        self._text: list[str] = []
        self._marks: list[dict] | None = None

    def text(self, s: str, marks: list[dict]) -> None:
        if not s:
            return
        if self._text and marks != self._marks:
            self._flush()
        self._marks = marks
        self._text.append(s)

    def node(self, node: dict) -> None:
        self._flush()
        self.nodes.append(node)

    def _flush(self) -> None:
        if self._text:
            node = {"type": "text", "text": "".join(self._text)}
            if self._marks:
                node["marks"] = self._marks
            self.nodes.append(node)
        self._text = []
        self._marks = None

    def take(self) -> list[dict]:
        self._flush()
        out, self.nodes = self.nodes, []
        return out

    def empty(self) -> bool:
        return not self.nodes and not self._text


def paragraph(attrs: dict, content: list[dict]) -> dict:
    node = {"type": "paragraph", "attrs": attrs}
    if content:
        node["content"] = content
    return node


def empty_paragraph(attrs: dict | None = None) -> dict:
    return paragraph(attrs or default_para_attrs(), [])


def column_widths(cells: list[dict], ncols: int, total: float) -> list[float]:
    """Solve grid column widths from cells {col, colspan, width}. Falls back to even split."""
    widths: list[float | None] = [None] * ncols
    for c in cells:
        if c["colspan"] == 1 and c["col"] < ncols and widths[c["col"]] is None:
            widths[c["col"]] = c["width"]
    for _ in range(4):  # spanning cells fix the remaining unknown column
        for c in cells:
            span = range(c["col"], min(ncols, c["col"] + c["colspan"]))
            unknown = [i for i in span if widths[i] is None]
            if len(unknown) == 1:
                known = sum(widths[i] or 0 for i in span if widths[i] is not None)
                widths[unknown[0]] = max(1.0, c["width"] - known)
    missing = [i for i in range(ncols) if widths[i] is None]
    if missing:
        rest = max(0.0, total - sum(w for w in widths if w is not None))
        each = rest / len(missing) if rest > 0 else (total / ncols if ncols else 0)
        for i in missing:
            widths[i] = each or 1.0
    return [float(w) for w in widths]  # type: ignore[arg-type]


WRAPS = ["SQUARE", "TOP_AND_BOTTOM", "BEHIND_TEXT", "IN_FRONT_OF_TEXT"]
VERT_REL = ["PAPER", "PAGE", "PARA"]
HORZ_REL = ["PAPER", "PAGE", "COLUMN", "PARA"]
V_ALIGN = ["TOP", "CENTER", "BOTTOM", "INSIDE", "OUTSIDE"]
H_ALIGN = ["LEFT", "CENTER", "RIGHT", "INSIDE", "OUTSIDE"]
OVERLAY_WRAPS = ("BEHIND_TEXT", "IN_FRONT_OF_TEXT")


def float_from_hwp5(attr: int, voff: int, hoff: int, width: int, height: int, z: int) -> dict | None:
    """HWP 5.0 common object attributes (스펙 표 70) -> float dict; None for treat-as-char objects."""
    if attr & 1:
        return None

    def pick(lst: list[str], v: int) -> str:
        return lst[v] if v < len(lst) else lst[0]

    return {
        "wrap": pick(WRAPS, (attr >> 21) & 0x7),
        "vertRelTo": pick(VERT_REL, (attr >> 3) & 0x3),
        "horzRelTo": pick(HORZ_REL, (attr >> 8) & 0x3),
        "vertAlign": pick(V_ALIGN, (attr >> 5) & 0x7),
        "horzAlign": pick(H_ALIGN, (attr >> 10) & 0x7),
        "vertOffset": pt(voff), "horzOffset": pt(hoff),
        "width": pt(width), "height": pt(height), "z": z, "hidden": False,
    }


def mark_covered(nodes: list[dict]) -> None:
    """Objects drawn over text at the same spot: hide those a later, higher one fully covers
    (a common way templates replace a cover page - the old one stays underneath)."""
    floats = [n for n in nodes
              if (n.get("attrs") or {}).get("float") and n["attrs"]["float"]["wrap"] in OVERLAY_WRAPS]
    for i, a in enumerate(floats):
        fa = a["attrs"]["float"]
        for b in floats[i + 1:]:
            fb = b["attrs"]["float"]
            same_place = ((fa["vertRelTo"], fa["horzRelTo"]) == (fb["vertRelTo"], fb["horzRelTo"])
                          and abs(fa["vertOffset"] - fb["vertOffset"]) < 2
                          and abs(fa["horzOffset"] - fb["horzOffset"]) < 2)
            covers = fb["width"] >= fa["width"] * 0.95 and fb["height"] >= fa["height"] * 0.95
            if same_place and covers and fb["z"] >= fa["z"]:
                fa["hidden"] = True
                break


def build_table(rows: list[list[dict]], ncols: int, total_width: float, cell_spacing: float = 0) -> dict:
    """rows: list of rows, each a list of cell dicts with
    col, row, colspan, rowspan, width (HWPUNIT), height (HWPUNIT), content, background, borders,
    vAlign, padding (pt dict). Returns a TipTap table node."""
    flat = [c for r in rows for c in r]
    grid = column_widths(flat, ncols, total_width) if ncols else []
    row_nodes = []
    for r in rows:
        cells = []
        height = max((c["height"] for c in r if c["rowspan"] == 1), default=0)
        for c in sorted(r, key=lambda c: c["col"]):
            span = range(c["col"], min(ncols, c["col"] + c["colspan"]))
            cells.append({
                "type": "tableCell",
                "attrs": {
                    "colspan": c["colspan"],
                    "rowspan": c["rowspan"],
                    "colwidth": [px(grid[i]) for i in span] or None,
                    "background": c.get("background"),
                    "borders": c.get("borders"),
                    "vAlign": c.get("vAlign", "top"),
                    "padding": c.get("padding"),
                },
                "content": c["content"] or [empty_paragraph()],
            })
        if cells:
            row_nodes.append({"type": "tableRow", "attrs": {"height": pt(height)}, "content": cells})
    return {
        "type": "table",
        "attrs": {"width": pt(sum(grid)), "cellSpacing": pt(cell_spacing), "align": "left", "float": None},
        "content": row_nodes,
    }
