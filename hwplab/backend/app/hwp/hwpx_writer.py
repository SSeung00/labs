"""Editor document model -> HWPX (OWPML) package.

Starts from python-hwpx's Hangul-made skeleton (Apache-2.0) so the default styles, numbering and
tab definitions Hangul expects are present, then appends the document's own fonts, char/para
properties and border fills after the skeleton's entries and writes one section.
"""

from __future__ import annotations

import copy
import io
import itertools
import random
import zipfile
from datetime import datetime, timezone
from importlib import resources

from hwpx.equation import estimate_equation_size
from lxml import etree
from PIL import Image

from app.hwp import model as M

NS = {
    "ha": "http://www.hancom.co.kr/hwpml/2011/app",
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hp10": "http://www.hancom.co.kr/hwpml/2016/paragraph",
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "opf": "http://www.idpf.org/2007/opf/",
}
LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"]
LANG_ATTRS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"]
BORDER_WIDTH_STEPS = M.BORDER_WIDTHS
SUBLIST_ATTRS = dict(id="", textDirection="HORIZONTAL", lineWrap="BREAK", vertAlign="TOP",
                     linkListIDRef="0", linkListNextIDRef="0", textWidth="0", textHeight="0",
                     hasTextRef="0", hasNumRef="0")
MEDIA = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif",
         "bmp": "image/bmp", "tif": "image/tiff", "tiff": "image/tiff", "wmf": "image/x-wmf",
         "emf": "image/x-emf", "svg": "image/svg+xml", "webp": "image/webp"}


def q(name: str) -> str:
    prefix, local = name.split(":")
    return "{%s}%s" % (NS[prefix], local)


def E(parent, name: str, attrs: dict | None = None, text: str | None = None):
    el = etree.SubElement(parent, q(name)) if parent is not None else etree.Element(q(name))
    for k, v in (attrs or {}).items():
        el.set(k, str(v))
    if text is not None:
        el.text = text
    return el


def pos_attrs(f: dict | None) -> dict:
    """hp:pos for an object: inline (treat as char) or placed with its original anchor."""
    if not f:
        return {"treatAsChar": "1", "affectLSpacing": "0", "flowWithText": "1", "allowOverlap": "0",
                "holdAnchorAndSO": "0", "vertRelTo": "PARA", "horzRelTo": "PARA", "vertAlign": "TOP",
                "horzAlign": "LEFT", "vertOffset": "0", "horzOffset": "0"}
    overlay = f.get("wrap") in ("BEHIND_TEXT", "IN_FRONT_OF_TEXT")
    return {"treatAsChar": "0", "affectLSpacing": "0", "flowWithText": "0" if overlay else "1",
            "allowOverlap": "1" if overlay else "0", "holdAnchorAndSO": "0",
            "vertRelTo": f.get("vertRelTo") or "PARA", "horzRelTo": f.get("horzRelTo") or "PARA",
            "vertAlign": f.get("vertAlign") or "TOP", "horzAlign": f.get("horzAlign") or "LEFT",
            # OWPML offsets are unsigned: negative values wrap around as 32-bit
            "vertOffset": hu(f.get("vertOffset")) & 0xFFFFFFFF, "horzOffset": hu(f.get("horzOffset")) & 0xFFFFFFFF}


def hu(points: float | None) -> int:
    """pt -> HWPUNIT"""
    return int(round((points or 0) * M.PT))


def _skeleton() -> dict[str, bytes]:
    data = resources.files("hwpx").joinpath("data/Skeleton.hwpx").read_bytes()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        return {n: z.read(n) for n in z.namelist()}


def _snap_width(mm: float) -> str:
    """OWPML only allows the 16 widths Hangul offers, written as e.g. '0.12 mm' or '1.0 mm'."""
    w = min(BORDER_WIDTH_STEPS, key=lambda s: abs(s - (mm or 0.12)))
    return f"{w:.1f} mm" if w >= 1 else f"{w:g} mm"


def _color(c: str | None, default: str = "#000000") -> str:
    return (c or default).upper()


class HwpxWriter:
    def __init__(self, doc: dict, binaries: dict[str, bytes], title: str = ""):
        self.doc = doc
        self.binaries = binaries
        self.title = title
        self.files = _skeleton()
        self.header = etree.fromstring(self.files["Contents/header.xml"])
        self.section_template = etree.fromstring(self.files["Contents/section0.xml"])
        ref = self.header.find(q("hh:refList"))
        self.fontfaces = ref.find(q("hh:fontfaces"))
        self.border_fills = ref.find(q("hh:borderFills"))
        self.char_props = ref.find(q("hh:charProperties"))
        self.para_props = ref.find(q("hh:paraProperties"))
        self.font_ids: dict[str, int] = {}
        for f in self.fontfaces.find(q("hh:fontface")).findall(q("hh:font")):
            self.font_ids[f.get("face")] = int(f.get("id"))
        self.char_ids: dict[tuple, int] = {}
        self.para_ids: dict[tuple, int] = {}
        self.fill_ids: dict[tuple, int] = {}
        self.next_char = len(self.char_props)
        self.next_para = len(self.para_props)
        self.next_fill = len(self.border_fills) + 1  # borderFill ids are 1-based
        self.images: dict[str, str] = {}  # src -> manifest id
        self.ids = itertools.count(random.randint(1_000_000_000, 1_500_000_000))
        self.footnotes = 0
        self.endnotes = 0
        self.default_cs = self.char_id(M.default_char())

    # ---------- header.xml entries ----------

    def font_id(self, face: str | None) -> int:
        face = face or M.DEFAULT_FONT
        if face not in self.font_ids:
            fid = len(self.font_ids)
            for ff in self.fontfaces.findall(q("hh:fontface")):
                font = E(ff, "hh:font", {"id": fid, "face": face, "type": "TTF", "isEmbedded": "0"})
                E(font, "hh:typeInfo", {"familyType": "FCAT_GOTHIC", "weight": "6", "proportion": "4",
                                        "contrast": "0", "strokeVariation": "1", "armStyle": "1",
                                        "letterform": "1", "midline": "1", "xHeight": "1"})
                ff.set("fontCnt", str(len(ff.findall(q("hh:font")))))
            self.font_ids[face] = fid
        return self.font_ids[face]

    def char_id(self, cs: dict) -> int:
        key = (cs.get("fontHangul"), cs.get("fontLatin"), cs.get("size"), cs.get("color"), cs.get("shade"),
               cs.get("spacing"), cs.get("ratio"), bool(cs.get("bold")), bool(cs.get("italic")),
               cs.get("underline"), bool(cs.get("strike")), bool(cs.get("superscript")), bool(cs.get("subscript")))
        if key in self.char_ids:
            return self.char_ids[key]
        cid = self.next_char
        self.next_char += 1
        hangul = self.font_id(cs.get("fontHangul"))
        latin = self.font_id(cs.get("fontLatin") or cs.get("fontHangul"))
        el = E(self.char_props, "hh:charPr", {
            "id": cid, "height": hu(cs.get("size") or 10), "textColor": _color(cs.get("color")),
            "shadeColor": _color(cs.get("shade")) if cs.get("shade") else "none",
            "useFontSpace": "0", "useKerning": "0", "symMark": "NONE", "borderFillIDRef": "2"})
        E(el, "hh:fontRef", {a: (latin if a == "latin" else hangul) for a in LANG_ATTRS})
        ratio = int(cs.get("ratio") or 100)
        spacing = int(cs.get("spacing") or 0)
        E(el, "hh:ratio", {a: ratio for a in LANG_ATTRS})
        E(el, "hh:spacing", {a: spacing for a in LANG_ATTRS})
        E(el, "hh:relSz", {a: 100 for a in LANG_ATTRS})
        E(el, "hh:offset", {a: 0 for a in LANG_ATTRS})
        if cs.get("italic"):
            E(el, "hh:italic")
        if cs.get("bold"):
            E(el, "hh:bold")
        u = {"bottom": "BOTTOM", "top": "TOP"}.get(cs.get("underline") or "", "NONE")
        E(el, "hh:underline", {"type": u, "shape": "SOLID", "color": _color(cs.get("color"))})
        E(el, "hh:strikeout", {"shape": "SOLID" if cs.get("strike") else "NONE", "color": _color(cs.get("color"))})
        E(el, "hh:outline", {"type": "NONE"})
        E(el, "hh:shadow", {"type": "NONE", "color": "#C0C0C0", "offsetX": "10", "offsetY": "10"})
        if cs.get("superscript"):
            E(el, "hh:supscript")
        elif cs.get("subscript"):
            E(el, "hh:subscript")
        self.char_props.set("itemCnt", str(self.next_char))
        self.char_ids[key] = cid
        return cid

    def para_id(self, a: dict) -> int:
        key = (a.get("align"), a.get("left"), a.get("right"), a.get("indent"), a.get("before"), a.get("after"),
               a.get("lineType"), a.get("line"), bool(a.get("keepWord")))
        if key in self.para_ids:
            return self.para_ids[key]
        pid = self.next_para
        self.next_para += 1
        el = E(self.para_props, "hh:paraPr", {
            "id": pid, "tabPrIDRef": "0", "condense": "0", "fontLineHeight": "0", "snapToGrid": "1",
            "suppressLineNumbers": "0", "checked": "0", "textDir": "LTR"})
        E(el, "hh:align", {"horizontal": M.HWPX_ALIGN.get(a.get("align") or "justify", "JUSTIFY"), "vertical": "BASELINE"})
        E(el, "hh:heading", {"type": "NONE", "idRef": "0", "level": "0"})
        E(el, "hh:breakSetting", {
            "breakLatinWord": "KEEP_WORD",
            "breakNonLatinWord": "KEEP_WORD" if a.get("keepWord") else "BREAK_WORD",
            "widowOrphan": "0", "keepWithNext": "0", "keepLines": "0", "pageBreakBefore": "0", "lineWrap": "BREAK"})
        E(el, "hh:autoSpacing", {"eAsianEng": "0", "eAsianNum": "0"})
        lt = a.get("lineType") or "percent"
        line = a.get("line") if a.get("line") is not None else 160
        sw = E(el, "hp:switch")
        for branch, scale in ((E(sw, "hp:case"), 1), (E(sw, "hp:default"), 2)):
            if scale == 1:
                branch.set(q("hp:required-namespace"), "http://www.hancom.co.kr/hwpml/2016/HwpUnitChar")
            mg = E(branch, "hh:margin")
            for name, val in (("intent", a.get("indent")), ("left", a.get("left")), ("right", a.get("right")),
                              ("prev", a.get("before")), ("next", a.get("after"))):
                E(mg, "hc:" + name, {"value": hu(val) * scale, "unit": "HWPUNIT"})
            value = int(line) if lt == "percent" else hu(line) * scale
            E(branch, "hh:lineSpacing", {"type": M.HWPX_LINE_TYPE.get(lt, "PERCENT"), "value": value, "unit": "HWPUNIT"})
        E(el, "hh:border", {"borderFillIDRef": "2", "offsetLeft": "0", "offsetRight": "0", "offsetTop": "0",
                            "offsetBottom": "0", "connect": "0", "ignoreMargin": "0"})
        self.para_props.set("itemCnt", str(self.next_para))
        self.para_ids[key] = pid
        return pid

    def fill_id(self, borders: dict | None, background: str | None) -> int:
        b = borders or {}
        key = tuple((s, (b.get(s) or {}).get("type"), (b.get(s) or {}).get("width"), (b.get(s) or {}).get("color"))
                    for s in ("left", "right", "top", "bottom")) + (background,)
        if key in self.fill_ids:
            return self.fill_ids[key]
        fid = self.next_fill
        self.next_fill += 1
        el = E(self.border_fills, "hh:borderFill", {"id": fid, "threeD": "0", "shadow": "0", "centerLine": "NONE",
                                                    "breakCellSeparateLine": "0"})
        E(el, "hh:slash", {"type": "NONE", "Crooked": "0", "isCounter": "0"})
        E(el, "hh:backSlash", {"type": "NONE", "Crooked": "0", "isCounter": "0"})
        for side in ("left", "right", "top", "bottom"):
            s = b.get(side) or {"type": "SOLID" if borders is None else "NONE", "width": 0.12, "color": "#000000"}
            E(el, f"hh:{side}Border", {"type": s.get("type") or "NONE", "width": _snap_width(s.get("width") or 0.12),
                                       "color": _color(s.get("color"))})
        E(el, "hh:diagonal", {"type": "SOLID", "width": "0.1 mm", "color": "#000000"})
        if background:
            fb = E(el, "hc:fillBrush")
            E(fb, "hc:winBrush", {"faceColor": _color(background), "hatchColor": "#999999", "alpha": "0"})
        self.border_fills.set("itemCnt", str(self.next_fill - 1))
        self.fill_ids[key] = fid
        return fid

    # ---------- section ----------

    def build_section(self) -> bytes:
        root = copy.deepcopy(self.section_template)
        first_p = root.find(q("hp:p"))
        sec_run = copy.deepcopy(first_p.find(q("hp:run")))
        for p in root.findall(q("hp:p")):
            root.remove(p)
        self._apply_page(sec_run)

        blocks = (self.doc.get("content") or {}).get("content") or [M.empty_paragraph()]
        # header/footer controls go where they were (they apply from that page on), else first
        anchors = {kind: next((i for i, b in enumerate(blocks)
                               if kind in ((b.get("attrs") or {}).get("hf") or [])), 0)
                   for kind in ("header", "footer")}
        for i, block in enumerate(blocks):
            p = self.block(root, block, body=True)
            if i == 0:
                p.insert(0, sec_run)
                self._page_number(p, 1)
            kinds = [k for k in ("header", "footer") if anchors[k] == i and self.doc.get(k)]
            if kinds:
                self._header_footer(p, 1 if i == 0 else 0, kinds)
        return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)

    def _apply_page(self, sec_run) -> None:
        page = self.doc.get("page") or M.default_page()
        sec = sec_run.find(q("hp:secPr"))
        pg = sec.find(q("hp:pagePr"))
        w, h = hu(page["width"]), hu(page["height"])
        landscape = bool(page.get("landscape"))
        if landscape:  # Hangul stores the paper upright and turns it with NARROWLY
            w, h = min(w, h), max(w, h)
        pg.set("width", str(w))
        pg.set("height", str(h))
        pg.set("landscape", "NARROWLY" if landscape else "WIDELY")
        mg = pg.find(q("hp:margin"))
        for k in ("left", "right", "top", "bottom", "header", "footer"):
            mg.set(k, str(hu(page.get(k))))
        mg.set("gutter", "0")
        hide = self.doc.get("hideFirst") or {}
        vis = sec.find(q("hp:visibility"))
        if vis is not None:
            vis.set("hideFirstHeader", "1" if hide.get("header") else "0")
            vis.set("hideFirstFooter", "1" if hide.get("footer") else "0")
            vis.set("hideFirstPageNum", "1" if hide.get("pageNum") else "0")

    def _header_footer(self, p, pos: int, kinds: list[str]) -> None:
        page = self.doc.get("page") or M.default_page()
        text_width = hu(page["width"] - page["left"] - page["right"])
        for kind in kinds:
            paras = self.doc.get(kind)
            run = etree.Element(q("hp:run"), charPrIDRef=str(self.default_cs))
            ctrl = E(run, "hp:ctrl")
            hf = E(ctrl, f"hp:{kind}", {"id": str(next(self.ids) % 100000), "applyPageType": "BOTH"})
            sub = E(hf, "hp:subList", {**SUBLIST_ATTRS, "textWidth": text_width,
                                       "textHeight": hu(page.get(kind) or 0)})
            for para in paras:
                self.block(sub, para, body=False)
            p.insert(pos, run)
            pos += 1

    def _page_number(self, p, pos: int) -> None:
        pn = self.doc.get("pageNumber")
        if pn and pn.get("pos"):
            run = etree.Element(q("hp:run"), charPrIDRef=str(self.default_cs))
            ctrl = E(run, "hp:ctrl")
            E(ctrl, "hp:pageNum", {"pos": pn["pos"], "formatType": "DIGIT", "sideChar": pn.get("side") or ""})
            p.insert(pos, run)

    def block(self, parent, node: dict, body: bool):
        attrs = node.get("attrs") or {}
        if node.get("type") == "table":
            anchor = {**M.default_para_attrs(), "align": attrs.get("align") or "left"}
            p = E(parent, "hp:p", {"id": "0" if body else "2147483648", "paraPrIDRef": self.para_id(anchor),
                                   "styleIDRef": "0", "pageBreak": "0", "columnBreak": "0", "merged": "0"})
            run = E(p, "hp:run", {"charPrIDRef": self.default_cs})
            self.table(run, node)
            E(run, "hp:t")
            return p
        p = E(parent, "hp:p", {"id": "0" if body else "2147483648", "paraPrIDRef": self.para_id(attrs),
                               "styleIDRef": "0", "pageBreak": "1" if attrs.get("pageBreak") else "0",
                               "columnBreak": "0", "merged": "0"})
        self.inlines(p, node.get("content") or [])
        return p

    def inlines(self, p, content: list[dict]) -> None:
        run = None
        run_cs = None
        t = None

        def get_run(cs_id: int):
            nonlocal run, run_cs, t
            if run is None or run_cs != cs_id:
                run = E(p, "hp:run", {"charPrIDRef": cs_id})
                run_cs = cs_id
                t = None
            return run

        def get_t():
            nonlocal t
            if t is None:
                t = E(run, "hp:t")
            return t

        def append_text(s: str) -> None:
            el = get_t()
            if len(el):
                last = el[-1]
                last.tail = (last.tail or "") + s
            else:
                el.text = (el.text or "") + s

        for node in content:
            typ = node.get("type")
            cs_id = self.char_id(_char_from_marks(node.get("marks") or [])) if typ == "text" else (run_cs or self.default_cs)
            get_run(cs_id)
            if typ == "text":
                parts = node.get("text", "").split("\t")
                for i, part in enumerate(parts):
                    if i:
                        E(get_t(), "hp:tab", {"width": "4000", "leader": "0", "type": "1"})
                    if part:
                        segs = part.split(" ")
                        for j, seg in enumerate(segs):
                            if j:
                                E(get_t(), "hp:nbSpace")
                            if seg:
                                append_text(seg)
            elif typ == "hardBreak":
                E(get_t(), "hp:lineBreak")
            elif typ == "image":
                self.picture(run, node.get("attrs") or {})
                t = None
            elif typ == "equation":
                self.equation(run, node.get("attrs") or {})
                t = None
            elif typ == "footnote":
                self.footnote(run, node.get("attrs") or {})
                t = None
        if run is None:
            E(E(p, "hp:run", {"charPrIDRef": self.default_cs}), "hp:t")

    def table(self, run, node: dict) -> None:
        rows = [r for r in node.get("content") or [] if r.get("type") == "tableRow"]
        fl = (node.get("attrs") or {}).get("float")
        # Resolve the grid: column addresses shift right past cells spanning down from above.
        occupied: set[tuple[int, int]] = set()
        placed = []
        ncols = 0
        col_widths: dict[int, float] = {}
        for r_i, row in enumerate(rows):
            c_i = 0
            for cell in row.get("content") or []:
                while (r_i, c_i) in occupied:
                    c_i += 1
                a = cell.get("attrs") or {}
                cs, rs = max(1, int(a.get("colspan") or 1)), max(1, int(a.get("rowspan") or 1))
                for dr in range(rs):
                    for dc in range(cs):
                        occupied.add((r_i + dr, c_i + dc))
                widths = a.get("colwidth") or []
                for k, w in enumerate(widths):
                    if w and (c_i + k) not in col_widths:
                        col_widths[c_i + k] = w / M.PX_PER_PT
                placed.append((r_i, c_i, cs, rs, cell))
                c_i += cs
                ncols = max(ncols, c_i)
        default_w = (self._body_width() / ncols) if ncols else 100
        row_heights = [max(float((r.get("attrs") or {}).get("height") or 0), 0) for r in rows]
        total_w = sum(col_widths.get(i, default_w) for i in range(ncols))
        total_h = sum(max(h, 10) for h in row_heights)
        tbl = E(run, "hp:tbl", {
            "id": next(self.ids), "zOrder": (fl or {}).get("z", 0), "numberingType": "TABLE",
            "textWrap": (fl or {}).get("wrap") or "TOP_AND_BOTTOM",
            "textFlow": "BOTH_SIDES", "lock": "0", "dropcapstyle": "None", "pageBreak": "CELL",
            "repeatHeader": "1", "rowCnt": len(rows), "colCnt": ncols, "cellSpacing": "0",
            "borderFillIDRef": self.fill_id({s: {"type": "NONE"} for s in ("left", "right", "top", "bottom")}, None),
            "noAdjust": "0"})
        E(tbl, "hp:sz", {"width": hu(total_w), "widthRelTo": "ABSOLUTE", "height": hu(total_h),
                         "heightRelTo": "ABSOLUTE", "protect": "0"})
        E(tbl, "hp:pos", pos_attrs(fl))
        E(tbl, "hp:outMargin", {"left": "141", "right": "141", "top": "141", "bottom": "141"})
        E(tbl, "hp:inMargin", {"left": "510", "right": "510", "top": "141", "bottom": "141"})
        by_row: dict[int, list] = {}
        for item in placed:
            by_row.setdefault(item[0], []).append(item)
        for r_i in range(len(rows)):
            tr = E(tbl, "hp:tr")
            for _, c_i, cs, rs, cell in by_row.get(r_i, []):
                a = cell.get("attrs") or {}
                pad = a.get("padding") or {"left": 5.1, "right": 5.1, "top": 1.41, "bottom": 1.41}
                tc = E(tr, "hp:tc", {"name": "", "header": "0", "hasMargin": "1", "protect": "0", "editable": "0",
                                     "dirty": "0", "borderFillIDRef": self.fill_id(a.get("borders"), a.get("background"))})
                va = {"middle": "CENTER", "bottom": "BOTTOM"}.get(a.get("vAlign") or "top", "TOP")
                sub = E(tc, "hp:subList", {**SUBLIST_ATTRS, "vertAlign": va})
                for para in cell.get("content") or [M.empty_paragraph()]:
                    self.block(sub, para, body=False)
                E(tc, "hp:cellAddr", {"colAddr": c_i, "rowAddr": r_i})
                E(tc, "hp:cellSpan", {"colSpan": cs, "rowSpan": rs})
                w = sum(col_widths.get(c_i + k, default_w) for k in range(cs))
                h = sum(max(row_heights[r_i + k] if r_i + k < len(row_heights) else 0, 10) for k in range(rs))
                E(tc, "hp:cellSz", {"width": hu(w), "height": hu(h)})
                E(tc, "hp:cellMargin", {k: hu(pad.get(k, 0)) for k in ("left", "right", "top", "bottom")})

    def _body_width(self) -> float:
        page = self.doc.get("page") or M.default_page()
        return page["width"] - page["left"] - page["right"]

    def _image_ref(self, src: str) -> tuple[str, tuple[int, int]] | None:
        data = self.binaries.get(src)
        if data is None:
            return None
        if src not in self.images:
            self.images[src] = f"image{len(self.images) + 1}"
        try:
            with Image.open(io.BytesIO(data)) as im:
                dims = im.size
        except Exception:
            dims = (0, 0)
        return self.images[src], dims

    def picture(self, run, a: dict) -> None:
        ref = self._image_ref(a.get("src") or "")
        if ref is None:
            return
        item_id, (pw, ph) = ref
        w, h = hu(a.get("width") or 100), hu(a.get("height") or 100)
        dim_w, dim_h = (pw * 75, ph * 75) if pw and ph else (w, h)
        fl = a.get("float")
        pic = E(run, "hp:pic", {"id": next(self.ids), "zOrder": (fl or {}).get("z", 0), "numberingType": "PICTURE",
                                "textWrap": (fl or {}).get("wrap") or "TOP_AND_BOTTOM", "textFlow": "BOTH_SIDES", "lock": "0",
                                "dropcapstyle": "None", "href": "", "groupLevel": "0",
                                "instid": next(self.ids), "reverse": "0"})
        E(pic, "hp:offset", {"x": "0", "y": "0"})
        E(pic, "hp:orgSz", {"width": w, "height": h})
        E(pic, "hp:curSz", {"width": w, "height": h})
        E(pic, "hp:flip", {"horizontal": "0", "vertical": "0"})
        E(pic, "hp:rotationInfo", {"angle": "0", "centerX": w // 2, "centerY": h // 2, "rotateimage": "1"})
        ri = E(pic, "hp:renderingInfo")
        for m in ("transMatrix", "scaMatrix", "rotMatrix"):
            E(ri, "hc:" + m, {"e1": "1", "e2": "0", "e3": "0", "e4": "0", "e5": "1", "e6": "0"})
        rect = E(pic, "hp:imgRect")
        for i, (x, y) in enumerate(((0, 0), (w, 0), (w, h), (0, h))):
            E(rect, f"hc:pt{i}", {"x": x, "y": y})
        E(pic, "hp:imgClip", {"left": "0", "right": dim_w, "top": "0", "bottom": dim_h})
        E(pic, "hp:inMargin", {"left": "0", "right": "0", "top": "0", "bottom": "0"})
        E(pic, "hp:imgDim", {"dimwidth": dim_w, "dimheight": dim_h})
        E(pic, "hc:img", {"binaryItemIDRef": item_id, "bright": "0", "contrast": "0", "effect": "REAL_PIC", "alpha": "0"})
        E(pic, "hp:effects")
        E(pic, "hp:sz", {"width": w, "widthRelTo": "ABSOLUTE", "height": h, "heightRelTo": "ABSOLUTE", "protect": "0"})
        E(pic, "hp:pos", pos_attrs(fl))
        E(pic, "hp:outMargin", {"left": "0", "right": "0", "top": "0", "bottom": "0"})
        E(pic, "hp:shapeComment", text="그림입니다.")

    def equation(self, run, a: dict) -> None:
        base = hu(a.get("size") or 10)
        width, height = hu(a.get("width")), hu(a.get("height"))
        if not width or not height:
            # new or edited equation: Hangul on Windows lays the page out with the stored box
            try:
                width, height = estimate_equation_size(a.get("script") or "", base_unit=base)
            except Exception:
                width, height = base * 2, base
        eq = E(run, "hp:equation", {
            "id": next(self.ids), "zOrder": "0", "numberingType": "EQUATION", "textWrap": "TOP_AND_BOTTOM",
            "textFlow": "BOTH_SIDES", "lock": "0", "dropcapstyle": "None", "version": "Equation Version 60",
            "baseLine": "85", "textColor": _color(a.get("color")), "baseUnit": base,
            "lineMode": "CHAR", "font": "HYhwpEQ"})
        E(eq, "hp:sz", {"width": width, "widthRelTo": "ABSOLUTE",
                        "height": height, "heightRelTo": "ABSOLUTE", "protect": "0"})
        E(eq, "hp:pos", {"treatAsChar": "1", "affectLSpacing": "0", "flowWithText": "1", "allowOverlap": "0",
                         "holdAnchorAndSO": "0", "vertRelTo": "PARA", "horzRelTo": "PARA", "vertAlign": "TOP",
                         "horzAlign": "LEFT", "vertOffset": "0", "horzOffset": "0"})
        E(eq, "hp:outMargin", {"left": "56", "right": "56", "top": "0", "bottom": "0"})
        E(eq, "hp:shapeComment", text="수식입니다.")
        E(eq, "hp:script", text=a.get("script") or "")

    def footnote(self, run, a: dict) -> None:
        kind = "endNote" if a.get("kind") == "end" else "footNote"
        if kind == "footNote":
            self.footnotes += 1
            num = self.footnotes
        else:
            self.endnotes += 1
            num = self.endnotes
        ctrl = E(run, "hp:ctrl")
        fn = E(ctrl, f"hp:{kind}", {"number": num, "suffixChar": "41", "instId": next(self.ids)})
        sub = E(fn, "hp:subList", SUBLIST_ATTRS)
        paras = a.get("content") or [M.empty_paragraph()]
        for i, para in enumerate(paras):
            p = self.block(sub, para, body=False)
            if i == 0:
                r = etree.Element(q("hp:run"), charPrIDRef=str(self.default_cs))
                c = E(r, "hp:ctrl")
                an = E(c, "hp:autoNum", {"num": num, "numType": "FOOTNOTE" if kind == "footNote" else "ENDNOTE"})
                E(an, "hp:autoNumFormat", {"type": "DIGIT", "userChar": "", "prefixChar": "", "suffixChar": ")",
                                           "supscript": "0"})
                E(r, "hp:t", text=" ")
                p.insert(0, r)

    # ---------- package ----------

    def build(self) -> bytes:
        section = self.build_section()
        header = etree.tostring(self.header, xml_declaration=True, encoding="UTF-8", standalone=True)
        files = dict(self.files)
        files["Contents/header.xml"] = header
        files["Contents/section0.xml"] = section
        files["Contents/content.hpf"] = self._content_hpf()
        files["Preview/PrvText.txt"] = _plain_text(self.doc)[:1024].encode("utf-8")
        bin_files = {}
        for src, item_id in self.images.items():
            ext = src.rsplit(".", 1)[-1].lower() if "." in src else "png"
            bin_files[f"BinData/{item_id}.{ext}"] = self.binaries[src]

        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr(zipfile.ZipInfo("mimetype"), files.pop("mimetype"), compress_type=zipfile.ZIP_STORED)
            order = ["version.xml", "Contents/header.xml"]
            for name in order:
                z.writestr(name, files.pop(name))
            for name, data in bin_files.items():
                stored = name.lower().endswith((".jpg", ".jpeg", ".png", ".gif"))  # already compressed
                z.writestr(name, data, compress_type=zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED)
            for name in ["Contents/section0.xml", "Preview/PrvText.txt", "settings.xml", "Preview/PrvImage.png",
                         "META-INF/container.rdf", "Contents/content.hpf", "META-INF/container.xml",
                         "META-INF/manifest.xml"]:
                if name in files:
                    z.writestr(name, files.pop(name))
            for name, data in files.items():
                z.writestr(name, data)
        return out.getvalue()

    def _content_hpf(self) -> bytes:
        root = etree.fromstring(self.files["Contents/content.hpf"])
        opf = NS["opf"]
        meta = root.find("{%s}metadata" % opf)
        title = meta.find("{%s}title" % opf)
        title.text = self.title or None
        now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        for m in meta.findall("{%s}meta" % opf):
            name = m.get("name")
            if name in ("creator", "lastsaveby"):
                m.text = "HwpLab"
            elif name in ("CreatedDate", "ModifiedDate"):
                m.text = now
            elif name == "date":
                m.text = None
        manifest = root.find("{%s}manifest" % opf)
        section_item = next(i for i in manifest if i.get("id") == "section0")
        for src, item_id in self.images.items():
            ext = src.rsplit(".", 1)[-1].lower() if "." in src else "png"
            item = etree.Element("{%s}item" % opf, id=item_id, href=f"BinData/{item_id}.{ext}",
                                 **{"media-type": MEDIA.get(ext, "application/octet-stream"), "isEmbeded": "1"})
            section_item.addprevious(item)
        return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)


def _char_from_marks(marks: list[dict]) -> dict:
    cs = M.default_char()
    for m in marks:
        t = m.get("type")
        a = m.get("attrs") or {}
        if t == "textStyle":
            for k in ("fontHangul", "fontLatin", "size", "color", "shade", "spacing", "ratio"):
                if a.get(k) is not None:
                    cs[k] = a[k]
        elif t in ("bold", "italic", "strike", "superscript", "subscript"):
            cs[t] = True
        elif t == "underline":
            cs["underline"] = a.get("type") or "bottom"
    return cs


def _plain_text(doc: dict) -> str:
    out: list[str] = []

    def walk(n: dict) -> None:
        if n.get("type") == "text":
            out.append(n.get("text", ""))
        for c in n.get("content") or []:
            walk(c)
        if n.get("type") == "paragraph":
            out.append("\r\n")

    walk(doc.get("content") or {})
    return "".join(out)


def write_hwpx(doc: dict, binaries: dict[str, bytes], title: str = "") -> bytes:
    return HwpxWriter(doc, binaries, title).build()
