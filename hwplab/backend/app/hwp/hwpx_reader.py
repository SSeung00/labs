"""HWPX (OWPML, KS X 6101) reader -> editor document model."""

from __future__ import annotations

import io
import posixpath
import re
import zipfile

from lxml import etree

from app.hwp import model as M

NS = {
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "opf": "http://www.idpf.org/2007/opf/",
}
HP = "{%s}" % NS["hp"]
HH = "{%s}" % NS["hh"]
HC = "{%s}" % NS["hc"]

LANGS = ["HANGUL", "LATIN", "HANJA", "JAPANESE", "OTHER", "SYMBOL", "USER"]
ALIGN_FROM_HWPX = {v: k for k, v in M.HWPX_ALIGN.items()}
LINE_FROM_HWPX = {v: k for k, v in M.HWPX_LINE_TYPE.items()}

PARSER = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=True, recover=True)


class HwpxError(ValueError):
    pass


def _color(v: str | None) -> str | None:
    if not v or v.lower() == "none" or not v.startswith("#"):
        return None
    v = v.lower()
    return v[:7] if len(v) >= 7 else None


def _int(v, default=0) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _signed(v: int) -> int:
    """Offsets are written as unsigned 32-bit; values past 2^31 are negative."""
    return v - (1 << 32) if v >= (1 << 31) else v


def _local(el) -> str:
    return etree.QName(el).localname if isinstance(el.tag, str) else ""


class HwpxDocument:
    def __init__(self, data: bytes):
        try:
            self.zip = zipfile.ZipFile(io.BytesIO(data))
        except zipfile.BadZipFile as e:
            raise HwpxError("HWPX(zip) 파일이 아니에요.") from e
        names = set(self.zip.namelist())
        self.names = names
        hpf = next((n for n in names if n.lower().endswith("content.hpf")), None)
        self.manifest: dict[str, str] = {}
        spine: list[str] = []
        if hpf:
            root = etree.fromstring(self.zip.read(hpf), PARSER)
            base = posixpath.dirname(hpf)
            for item in root.iter("{%s}item" % NS["opf"]):
                href = item.get("href", "")
                # hrefs are package-root relative in practice; fall back to hpf-relative
                path = href if href in names else posixpath.normpath(posixpath.join(base, href))
                self.manifest[item.get("id", "")] = path
            for ref in root.iter("{%s}itemref" % NS["opf"]):
                p = self.manifest.get(ref.get("idref", ""))
                if p and re.search(r"section\d+\.xml$", p):
                    spine.append(p)
        if not spine:
            spine = sorted((n for n in names if re.match(r"Contents/section\d+\.xml$", n)),
                           key=lambda n: int(re.findall(r"\d+", n)[-1]))
        if not spine:
            raise HwpxError("본문(section) XML이 없어요.")
        self.sections = spine
        header = "Contents/header.xml" if "Contents/header.xml" in names else next(
            (n for n in names if n.endswith("header.xml")), None)
        self.binaries: dict[str, bytes] = {}
        self._read_header(etree.fromstring(self.zip.read(header), PARSER) if header else None)

    # ---------- header.xml ----------

    def _read_header(self, root) -> None:
        self.fonts: dict[str, dict[str, str]] = {lang: {} for lang in LANGS}
        self.char_shapes: dict[str, dict] = {}
        self.para_shapes: dict[str, dict] = {}
        self.border_fills: dict[str, dict] = {}
        if root is None:
            return
        for ff in root.iter(HH + "fontface"):
            lang = ff.get("lang", "HANGUL")
            for f in ff.findall(HH + "font"):
                self.fonts.setdefault(lang, {})[f.get("id", "")] = f.get("face", "")
        for bf in root.iter(HH + "borderFill"):
            borders = {}
            for side in ("left", "right", "top", "bottom"):
                el = bf.find(HH + side + "Border")
                if el is None:
                    continue
                w = el.get("width", "0.12 mm").replace("mm", "").strip()
                try:
                    width = float(w)
                except ValueError:
                    width = 0.12
                borders[side] = {"type": el.get("type", "NONE"), "width": width,
                                 "color": _color(el.get("color")) or "#000000"}
            fill = None
            brush = bf.find(f"{HC}fillBrush/{HC}winBrush")
            if brush is not None:
                fill = _color(brush.get("faceColor"))
            self.border_fills[bf.get("id", "")] = {"borders": borders or None, "fill": fill}
        for cp in root.iter(HH + "charPr"):
            self.char_shapes[cp.get("id", "")] = self._char_pr(cp)
        for pp in root.iter(HH + "paraPr"):
            self.para_shapes[pp.get("id", "")] = self._para_pr(pp)

    def _char_pr(self, cp) -> dict:
        ref = cp.find(HH + "fontRef")
        ratio = cp.find(HH + "ratio")
        spacing = cp.find(HH + "spacing")
        underline = cp.find(HH + "underline")
        strike = cp.find(HH + "strikeout")
        u = underline.get("type", "NONE") if underline is not None else "NONE"
        hangul = self.fonts.get("HANGUL", {}).get(ref.get("hangul", "0")) if ref is not None else None
        latin = self.fonts.get("LATIN", {}).get(ref.get("latin", "0")) if ref is not None else None
        shade = _color(cp.get("shadeColor"))
        return {
            "fontHangul": hangul, "fontLatin": latin or hangul,
            "size": M.rnd(_int(cp.get("height"), 1000) / 100),
            "color": _color(cp.get("textColor")) or "#000000",
            "shade": None if shade == "#ffffff" else shade,
            "ratio": _int(ratio.get("hangul"), 100) if ratio is not None else 100,
            "spacing": _int(spacing.get("hangul"), 0) if spacing is not None else 0,
            "bold": cp.find(HH + "bold") is not None,
            "italic": cp.find(HH + "italic") is not None,
            "underline": {"BOTTOM": "bottom", "TOP": "top", "CENTER": None}.get(u),
            "strike": strike is not None and strike.get("shape", "NONE") not in ("NONE", ""),
            "superscript": cp.find(HH + "supscript") is not None,
            "subscript": cp.find(HH + "subscript") is not None,
        }

    def _para_pr(self, pp) -> dict:
        align = pp.find(HH + "align")
        # Prefer the hp:case branch (true HWPUNIT); hp:default and bare elements hold legacy 2x values.
        case = pp.find(f"{HP}switch/{HP}case")
        scale = 1.0
        holder = case
        if holder is None:
            holder = pp
            scale = 0.5
        margin = holder.find(HH + "margin")
        line = holder.find(HH + "lineSpacing")

        def m(name: str) -> float:
            if margin is None:
                return 0
            el = margin.find(HC + name)
            return M.pt(_int(el.get("value")) * scale) if el is not None else 0

        lt = LINE_FROM_HWPX.get(line.get("type", "PERCENT"), "percent") if line is not None else "percent"
        lv = _int(line.get("value"), 160) if line is not None else 160
        brk = pp.find(HH + "breakSetting")
        return {
            "align": ALIGN_FROM_HWPX.get(align.get("horizontal", "JUSTIFY"), "justify") if align is not None else "justify",
            "left": m("left"), "right": m("right"), "indent": m("intent"),
            "before": m("prev"), "after": m("next"),
            "lineType": lt, "line": lv if lt == "percent" else M.pt(lv * scale),
            "pageBreak": brk is not None and brk.get("pageBreakBefore") == "1",
            "keepWord": brk is not None and brk.get("breakNonLatinWord") == "KEEP_WORD",
        }

    # ---------- sections ----------

    def convert(self) -> dict:
        self.page = M.default_page()
        self._page_set = False
        self.header = None
        self.footer = None
        self.page_number = None
        self.hide_first = None
        blocks: list[dict] = []
        for name in self.sections:
            root = etree.fromstring(self.zip.read(name), PARSER)
            for p in root.findall(HP + "p"):
                blocks.extend(self._paragraph(p))
        return {
            "page": self.page, "header": self.header, "footer": self.footer,
            "pageNumber": self.page_number, "hideFirst": self.hide_first,
            "content": {"type": "doc", "content": blocks or [M.empty_paragraph()]},
        }

    def _paragraphs(self, parent) -> list[dict]:
        out: list[dict] = []
        if parent is not None:
            for p in parent.findall(HP + "p"):
                out.extend(self._paragraph(p))
        return out or [M.empty_paragraph()]

    def _paragraph(self, p) -> list[dict]:
        ps = self.para_shapes.get(p.get("paraPrIDRef", "0"), {})
        attrs = M.default_para_attrs()
        for k in attrs:
            if k in ps:
                attrs[k] = ps[k]
        if p.get("pageBreak") == "1":
            attrs["pageBreak"] = True

        blocks: list[dict] = []
        trailing: list[dict] = []
        inl = M.InlineBuilder()

        def flush() -> None:
            content = inl.take()
            if content:
                blocks.append(M.paragraph(dict(attrs), content))
                attrs["pageBreak"] = False

        runs = p.findall(HP + "run")
        if runs:
            attrs["size"] = self.char_shapes.get(runs[0].get("charPrIDRef", "0"), M.default_char())["size"]
        for run in runs:
            cs = self.char_shapes.get(run.get("charPrIDRef", "0"), M.default_char())
            marks = M.marks_for(cs)
            for el in run:
                tag = _local(el)
                if tag == "t":
                    self._text(el, inl, marks)
                elif tag == "secPr":
                    self._sec_pr(el)
                elif tag == "ctrl":
                    self._ctrl(el, inl, attrs)
                elif tag == "tbl":
                    table = self._table(el)
                    if table:
                        flush()
                        if attrs.get("align") in ("center", "right") and not table["attrs"]["float"]:
                            table["attrs"]["align"] = attrs["align"]
                        blocks.append(table)
                        attrs["pageBreak"] = False
                elif tag == "pic":
                    img = self._picture(el)
                    if img:
                        inl.node(img)
                elif tag == "equation":
                    inl.node(self._equation(el))
                elif tag in ("rect", "ellipse", "polygon", "container", "curve", "arc"):
                    for sub in el.iter(HP + "subList"):
                        trailing.extend(self._paragraphs(sub))
                    for pic in el.iter(HP + "pic"):
                        img = self._picture(pic)
                        if img:
                            inl.node(img)
        content = inl.take()
        if content or not blocks:
            blocks.append(M.paragraph(dict(attrs), content))
        M.mark_covered(blocks)
        return blocks + trailing

    def _text(self, t, inl: M.InlineBuilder, marks: list[dict]) -> None:
        if t.text:
            inl.text(t.text, marks)
        for child in t:
            tag = _local(child)
            if tag == "tab":
                inl.text("\t", marks)
            elif tag == "lineBreak":
                inl.node({"type": "hardBreak"})
            elif tag in ("nbSpace", "fwSpace"):
                inl.text(" ", marks)
            elif tag == "hyphen":
                inl.text("-", marks)
            if child.tail:
                inl.text(child.tail, marks)

    def _sec_pr(self, sec) -> None:
        if self._page_set:
            return
        vis = sec.find(HP + "visibility")
        if vis is not None:
            self.hide_first = {"header": vis.get("hideFirstHeader") == "1", "footer": vis.get("hideFirstFooter") == "1",
                               "pageNum": vis.get("hideFirstPageNum") == "1"}
        pg = sec.find(HP + "pagePr")
        if pg is None:
            return
        mg = pg.find(HP + "margin")
        w, h = _int(pg.get("width"), 59528), _int(pg.get("height"), 84188)
        # Hangul writes WIDELY for ordinary portrait pages; NARROWLY turns the paper sideways.
        landscape = pg.get("landscape") == "NARROWLY"
        if landscape and h > w or not landscape and w > h:
            w, h = h, w

        def g(k: str) -> int:
            return _int(mg.get(k)) if mg is not None else 0

        self.page = {
            "width": M.pt(w), "height": M.pt(h),
            "left": M.pt(g("left") + g("gutter")), "right": M.pt(g("right")),
            "top": M.pt(g("top")), "bottom": M.pt(g("bottom")),
            "header": M.pt(g("header")), "footer": M.pt(g("footer")), "landscape": landscape,
        }
        self._page_set = True

    def _ctrl(self, ctrl, inl: M.InlineBuilder, attrs: dict) -> None:
        for el in ctrl:
            tag = _local(el)
            if tag in ("header", "footer"):
                if getattr(self, tag) is None:
                    setattr(self, tag, self._paragraphs(el.find(HP + "subList")))
                    attrs["hf"] = (attrs.get("hf") or []) + [tag]
            elif tag in ("footNote", "endNote"):
                inl.node({"type": "footnote", "attrs": {
                    "kind": "foot" if tag == "footNote" else "end",
                    "content": self._paragraphs(el.find(HP + "subList"))}})
            elif tag == "pageNum" and self.page_number is None:
                pos = el.get("pos", "BOTTOM_CENTER")
                if pos != "NONE":
                    self.page_number = {"pos": pos, "side": el.get("sideChar", "")}

    def _cell_style(self, bf_id: str | None) -> dict:
        bf = self.border_fills.get(bf_id or "")
        return {"borders": bf["borders"], "background": bf["fill"]} if bf else {"borders": None, "background": None}

    def _table(self, tbl) -> dict | None:
        ncols = _int(tbl.get("colCnt"))
        nrows = _int(tbl.get("rowCnt"))
        sz = tbl.find(HP + "sz")
        total = _int(sz.get("width")) if sz is not None else 0
        inm = tbl.find(HP + "inMargin")
        default_pad = [_int(inm.get(k)) for k in ("left", "right", "top", "bottom")] if inm is not None else [510, 510, 141, 141]
        rows: list[list[dict]] = [[] for _ in range(max(nrows, 0))]
        for r_i, tr in enumerate(tbl.findall(HP + "tr")):
            for tc in tr.findall(HP + "tc"):
                addr = tc.find(HP + "cellAddr")
                span = tc.find(HP + "cellSpan")
                csz = tc.find(HP + "cellSz")
                cm = tc.find(HP + "cellMargin")
                sub = tc.find(HP + "subList")
                row = _int(addr.get("rowAddr"), r_i) if addr is not None else r_i
                pad = default_pad
                if tc.get("hasMargin") == "1" and cm is not None:
                    pad = [_int(cm.get(k)) for k in ("left", "right", "top", "bottom")]
                va = (sub.get("vertAlign", "TOP") if sub is not None else "TOP").upper()
                style = self._cell_style(tc.get("borderFillIDRef"))
                cell = {
                    "col": _int(addr.get("colAddr")) if addr is not None else 0,
                    "row": row,
                    "colspan": max(1, _int(span.get("colSpan"), 1)) if span is not None else 1,
                    "rowspan": max(1, _int(span.get("rowSpan"), 1)) if span is not None else 1,
                    "width": _int(csz.get("width")) if csz is not None else 0,
                    "height": _int(csz.get("height")) if csz is not None else 0,
                    "content": self._paragraphs(sub),
                    "background": style["background"], "borders": style["borders"],
                    "vAlign": {"CENTER": "middle", "BOTTOM": "bottom"}.get(va, "top"),
                    "padding": {"left": M.pt(pad[0]), "right": M.pt(pad[1]), "top": M.pt(pad[2]), "bottom": M.pt(pad[3])},
                }
                while row >= len(rows):
                    rows.append([])
                rows[row].append(cell)
        if not any(rows):
            return None
        table = M.build_table(rows, ncols or max(len(r) for r in rows), total, _int(tbl.get("cellSpacing")))
        table["attrs"]["float"] = _float(tbl)
        return table

    def _picture(self, pic) -> dict | None:
        img = pic.find(f"{HC}img")
        if img is None:
            return None
        ref = img.get("binaryItemIDRef", "")
        path = self.manifest.get(ref) or next(
            (n for n in self.names if n.startswith("BinData/") and posixpath.splitext(posixpath.basename(n))[0] == ref), None)
        if not path or path not in self.names:
            return None
        name = posixpath.basename(path)
        if name not in self.binaries:
            self.binaries[name] = self.zip.read(path)
        size = pic.find(HP + "curSz")
        if size is None or not _int(size.get("width")):
            size = pic.find(HP + "sz")
        w = _int(size.get("width")) if size is not None else 0
        h = _int(size.get("height")) if size is not None else 0
        return {"type": "image", "attrs": {"src": name, "width": M.pt(w), "height": M.pt(h), "alt": "",
                                           "float": _float(pic)}}

    def _equation(self, eq) -> dict:
        script = eq.findtext(HP + "script") or ""
        sz = eq.find(HP + "sz")
        return {"type": "equation", "attrs": {
            "script": script,
            "width": M.pt(_int(sz.get("width"))) if sz is not None else 0,
            "height": M.pt(_int(sz.get("height"))) if sz is not None else 0,
            "size": M.rnd(_int(eq.get("baseUnit"), 1000) / 100),
            "color": _color(eq.get("textColor")) or "#000000",
        }}


def _float(obj) -> dict | None:
    pos = obj.find(HP + "pos")
    if pos is None or pos.get("treatAsChar", "1") == "1":
        return None
    sz = obj.find(HP + "sz")
    wrap = obj.get("textWrap", "TOP_AND_BOTTOM")
    return {
        "wrap": wrap if wrap in M.WRAPS else "TOP_AND_BOTTOM",
        "vertRelTo": pos.get("vertRelTo", "PARA"), "horzRelTo": pos.get("horzRelTo", "PARA"),
        "vertAlign": pos.get("vertAlign", "TOP"), "horzAlign": pos.get("horzAlign", "LEFT"),
        "vertOffset": M.pt(_signed(_int(pos.get("vertOffset")))),
        "horzOffset": M.pt(_signed(_int(pos.get("horzOffset")))),
        "width": M.pt(_int(sz.get("width"))) if sz is not None else 0,
        "height": M.pt(_int(sz.get("height"))) if sz is not None else 0,
        "z": _int(obj.get("zOrder")), "hidden": False,
    }


def read_hwpx(data: bytes) -> tuple[dict, dict[str, bytes]]:
    doc = HwpxDocument(data)
    return doc.convert(), doc.binaries
