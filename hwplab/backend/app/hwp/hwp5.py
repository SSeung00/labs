"""HWP 5.0 (binary, OLE compound file) reader -> editor document model.

Based on the public "한글 문서 파일 형식 5.0" specification published by Hancom.
Distribution (배포용) and password-protected documents are rejected: their body is encrypted.
"""

from __future__ import annotations

import io
import struct
import zlib

import olefile

from app.hwp import model as M
from app.hwp.records import (
    TAG_BIN_DATA, TAG_BORDER_FILL, TAG_CHAR_SHAPE, TAG_CTRL_HEADER, TAG_EQEDIT, TAG_FACE_NAME,
    TAG_ID_MAPPINGS, TAG_LIST_HEADER, TAG_PAGE_DEF, TAG_PARA_CHAR_SHAPE, TAG_PARA_HEADER,
    TAG_PARA_SHAPE, TAG_PARA_TEXT, TAG_SHAPE_COMPONENT, TAG_SHAPE_COMPONENT_PICTURE, TAG_TABLE,
    Reader, Record, colorref, ctrl_id, ctrl_name, iter_records, record_tree,
)


class HwpError(ValueError):
    pass


# Control characters inside PARA_TEXT (스펙 표 6). Everything else below 32 that is not listed
# here is a 1-unit char control.
EXTENDED_CTRLS = {1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23}  # 8 units + CTRL_HEADER
INLINE_CTRLS = {4, 5, 6, 7, 8, 9, 19, 20}  # 8 units, no CTRL_HEADER

CTRL_TABLE = ctrl_id("tbl ")
CTRL_GSO = ctrl_id("gso ")
CTRL_EQ = ctrl_id("eqed")
CTRL_SECD = ctrl_id("secd")
CTRL_HEADER = ctrl_id("head")
CTRL_FOOTER = ctrl_id("foot")
CTRL_FOOTNOTE = ctrl_id("fn  ")
CTRL_ENDNOTE = ctrl_id("en  ")
CTRL_PAGE_NUM_POS = ctrl_id("pgnp")

LANGS = ["hangul", "latin", "hanja", "japanese", "other", "symbol", "user"]

PAGE_NUM_POS = [
    None, "TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT",
    "OUTSIDE_TOP", "OUTSIDE_BOTTOM", "INSIDE_TOP", "INSIDE_BOTTOM",
]


class Hwp5Document:
    def __init__(self, data: bytes):
        try:
            self.ole = olefile.OleFileIO(io.BytesIO(data))
        except OSError as e:
            raise HwpError("HWP 5.0 파일이 아니에요 (OLE 구조를 읽을 수 없음).") from e
        header = self._raw("FileHeader")
        if not header.startswith(b"HWP Document File"):
            raise HwpError("HWP 5.0 파일 서명이 없어요.")
        (self.version,) = struct.unpack_from("<I", header, 32)
        (flags,) = struct.unpack_from("<I", header, 36)
        self.compressed = bool(flags & 1)
        if flags & 2:
            raise HwpError("암호가 걸린 문서는 열 수 없어요.")
        if flags & 4:
            raise HwpError("배포용 문서는 본문이 암호화되어 있어 열 수 없어요.")

        self.binaries: dict[str, bytes] = {}
        self._read_docinfo()

    # ---------- streams ----------

    def _raw(self, name: str) -> bytes:
        with self.ole.openstream(name) as f:
            return f.read()

    def _stream(self, name: str) -> bytes:
        data = self._raw(name)
        if self.compressed:
            try:
                return zlib.decompress(data, -15)
            except zlib.error:
                return data
        return data

    def _sections(self) -> list[str]:
        names = ["/".join(e) for e in self.ole.listdir() if len(e) == 2 and e[0] == "BodyText"]
        return sorted(names, key=lambda n: int("".join(ch for ch in n.split("/")[1] if ch.isdigit()) or 0))

    # ---------- DocInfo ----------

    def _read_docinfo(self) -> None:
        recs = list(iter_records(self._stream("DocInfo")))
        counts: list[int] = []
        faces: list[str] = []
        self.bin_items: list[dict] = []
        self.border_fills: list[dict] = []
        self.char_shapes: list[dict] = []
        self.para_shapes: list[dict] = []
        raw_char_shapes: list[bytes] = []
        for r in recs:
            if r.tag == TAG_ID_MAPPINGS:
                rd = Reader(r.data)
                counts = [rd.i32() for _ in range(len(r.data) // 4)]
            elif r.tag == TAG_FACE_NAME:
                rd = Reader(r.data)
                rd.u8()
                faces.append(rd.wstr())
            elif r.tag == TAG_BIN_DATA:
                self.bin_items.append(self._bin_item(r.data))
            elif r.tag == TAG_BORDER_FILL:
                self.border_fills.append(self._border_fill(r.data))
            elif r.tag == TAG_CHAR_SHAPE:
                raw_char_shapes.append(r.data)
            elif r.tag == TAG_PARA_SHAPE:
                self.para_shapes.append(self._para_shape(r.data))

        # Face names come grouped by language: counts[1..7] = 한글, 영어, 한자, 일어, 기타, 기호, 사용자.
        self.faces_by_lang: dict[str, list[str]] = {}
        pos = 0
        lang_counts = counts[1:8] if len(counts) >= 8 else [len(faces)] + [0] * 6
        for lang, n in zip(LANGS, lang_counts):
            self.faces_by_lang[lang] = faces[pos:pos + max(0, n)]
            pos += max(0, n)
        self.char_shapes = [self._char_shape(d) for d in raw_char_shapes]

    def _face(self, lang: str, idx: int) -> str | None:
        lst = self.faces_by_lang.get(lang) or []
        return lst[idx] if 0 <= idx < len(lst) else None

    def _bin_item(self, data: bytes) -> dict:
        rd = Reader(data)
        attr = rd.u16()
        kind = attr & 0xF  # 0 link, 1 embedding, 2 storage
        if kind == 0:
            return {"kind": "link"}
        bin_id = rd.u16()
        ext = rd.wstr().lower() if kind == 1 else ""
        return {"kind": "embed" if kind == 1 else "storage", "id": bin_id, "ext": ext,
                "compress": (attr >> 4) & 0x3}

    def _border_fill(self, data: bytes) -> dict:
        rd = Reader(data)
        rd.u16()  # attr (3D, shadow, slash flags)
        borders = {}
        for side in ("left", "right", "top", "bottom"):
            t, w, c = rd.u8(), rd.u8(), rd.u32()
            borders[side] = {
                "type": M.BORDER_TYPES[t] if t < len(M.BORDER_TYPES) else "SOLID",
                "width": M.BORDER_WIDTHS[w] if w < len(M.BORDER_WIDTHS) else 0.12,
                "color": colorref(c) or "#000000",
            }
        rd.skip(6)  # diagonal
        fill = None
        fill_type = rd.u32()
        if fill_type & 1:
            fill = colorref(rd.u32())
        return {"borders": borders, "fill": fill}

    def _char_shape(self, data: bytes) -> dict:
        rd = Reader(data)
        face_ids = [rd.u16() for _ in range(7)]
        ratio = [rd.u8() for _ in range(7)]
        spacing = [rd.i8() for _ in range(7)]
        rd.skip(7)  # relative size
        rd.skip(7)  # offset
        base = rd.i32()
        attr = rd.u32()
        rd.skip(2)  # shadow gaps
        color = colorref(rd.u32())
        rd.u32()  # underline colour
        shade = colorref(rd.u32())
        underline = (attr >> 2) & 0x3
        return {
            "fontHangul": self._face("hangul", face_ids[0]),
            "fontLatin": self._face("latin", face_ids[1]),
            "size": M.rnd(base / 100),
            "ratio": ratio[0] or 100,
            "spacing": spacing[0],
            "bold": bool(attr & 0x2),
            "italic": bool(attr & 0x1),
            "underline": {1: "bottom", 3: "top"}.get(underline),
            "superscript": bool(attr & (1 << 15)),
            "subscript": bool(attr & (1 << 16)),
            "strike": bool((attr >> 18) & 0x7),
            "color": color or "#000000",
            "shade": None if shade in (None, "#ffffff") else shade,
        }

    def _para_shape(self, data: bytes) -> dict:
        rd = Reader(data)
        attr1 = rd.u32()
        # Margins/indent/spacing are stored at twice their HWPUNIT value (see HWPX hp:switch default).
        left, right, indent, before, after = (rd.i32() for _ in range(5))
        line_old = rd.i32()
        rd.skip(2 + 2)  # tab def, numbering/bullet id
        border_fill = rd.u16()
        rd.skip(8)  # border offsets
        rd.u32()  # attr2
        line_type, line = attr1 & 0x3, line_old
        if len(data) >= 54:
            attr3 = rd.u32()
            line_type, line = attr3 & 0x1F, rd.u32()
        lt = M.LINE_TYPES[line_type] if line_type < len(M.LINE_TYPES) else "percent"
        align = (attr1 >> 2) & 0x7
        return {
            "align": M.ALIGNS[align] if align < len(M.ALIGNS) else "justify",
            "left": M.pt(left / 2), "right": M.pt(right / 2), "indent": M.pt(indent / 2),
            "before": M.pt(before / 2), "after": M.pt(after / 2),
            "lineType": lt,
            "line": line if lt == "percent" else M.pt(line / 2),
            "pageBreak": bool(attr1 & (1 << 19)),
            "keepWord": not (attr1 >> 7) & 1,  # bit 7: Korean line break unit, 0 = word, 1 = character
            "borderFill": border_fill,
        }

    # ---------- body ----------

    def convert(self) -> dict:
        self.page = M.default_page()
        self._page_set = False
        self.header: list[dict] | None = None
        self.footer: list[dict] | None = None
        self.page_number: dict | None = None
        self.hide_first: dict | None = None
        blocks: list[dict] = []
        for name in self._sections():
            for rec in record_tree(self._stream(name)):
                if rec.tag == TAG_PARA_HEADER:
                    blocks.extend(self._paragraph(rec))
        if not blocks:
            blocks = [M.empty_paragraph()]
        return {
            "page": self.page,
            "header": self.header,
            "footer": self.footer,
            "pageNumber": self.page_number,
            "hideFirst": self.hide_first,
            "content": {"type": "doc", "content": blocks},
        }

    def _paragraphs(self, recs: list[Record]) -> list[dict]:
        out: list[dict] = []
        for r in recs:
            if r.tag == TAG_PARA_HEADER:
                out.extend(self._paragraph(r))
        return out or [M.empty_paragraph()]

    def _para_attrs(self, shape_id: int, break_type: int) -> dict:
        ps = self.para_shapes[shape_id] if shape_id < len(self.para_shapes) else {}
        attrs = M.default_para_attrs()
        for k in attrs:
            if k in ps:
                attrs[k] = ps[k]
        if break_type & 0x04 or break_type & 0x01:  # page break / section break
            attrs["pageBreak"] = True
        return attrs

    def _paragraph(self, rec: Record) -> list[dict]:
        rd = Reader(rec.data)
        rd.u32()  # nchars
        rd.u32()  # control mask
        shape_id = rd.u16()
        rd.u8()  # style
        break_type = rd.u8()
        attrs = self._para_attrs(shape_id, break_type)

        text_rec = rec.first(TAG_PARA_TEXT)
        units = struct.unpack(f"<{len(text_rec.data) // 2}H", text_rec.data[: len(text_rec.data) // 2 * 2]) if text_rec else ()
        runs: list[tuple[int, int]] = []
        cs_rec = rec.first(TAG_PARA_CHAR_SHAPE)
        if cs_rec:
            for i in range(len(cs_rec.data) // 8):
                runs.append(struct.unpack_from("<II", cs_rec.data, i * 8))
        if not runs:
            runs = [(0, 0)]
        first_cs = runs[0][1]
        if first_cs < len(self.char_shapes):
            attrs["size"] = self.char_shapes[first_cs]["size"]
        ctrls = iter(rec.all(TAG_CTRL_HEADER))

        blocks: list[dict] = []
        trailing: list[dict] = []  # text boxes etc. flattened after the paragraph
        inl = M.InlineBuilder()
        run_idx = 0
        marks_cache: dict[int, list[dict]] = {}

        def marks_at(pos: int) -> list[dict]:
            nonlocal run_idx
            while run_idx + 1 < len(runs) and runs[run_idx + 1][0] <= pos:
                run_idx += 1
            cid = runs[run_idx][1]
            if cid not in marks_cache:
                cs = self.char_shapes[cid] if cid < len(self.char_shapes) else M.default_char()
                marks_cache[cid] = M.marks_for(cs)
            return marks_cache[cid]

        def flush_paragraph(force: bool = False) -> None:
            content = inl.take()
            if content or force:
                blocks.append(M.paragraph(dict(attrs), content))

        i, n = 0, len(units)
        buf: list[str] = []
        buf_start = 0

        def flush_text() -> None:
            nonlocal buf
            if buf:
                inl.text("".join(buf), marks_at(buf_start))
                buf = []

        while i < n:
            ch = units[i]
            if ch >= 32:
                if not buf:
                    buf_start = i
                # surrogate pairs are kept as-is and decoded below
                buf.append(chr(ch))
                i += 1
                continue
            flush_text()
            if ch in EXTENDED_CTRLS:
                ctrl = next(ctrls, None)
                if ctrl is not None:
                    self._control(ctrl, inl, blocks, trailing, attrs, marks_at(i), flush_paragraph)
                i += 8
            elif ch in INLINE_CTRLS:
                if ch == 9:
                    inl.text("\t", marks_at(i))
                i += 8
            else:
                if ch == 10:
                    inl.node({"type": "hardBreak"})
                elif ch == 13:
                    pass
                elif ch == 24:
                    inl.text("-", marks_at(i))
                elif ch in (30, 31):
                    inl.text(" ", marks_at(i))
                i += 1
        flush_text()

        content = inl.take()
        if content or not blocks:
            blocks.append(M.paragraph(dict(attrs), content))
        # A paragraph that only anchors a table should not leave an extra empty line before it.
        if attrs.get("pageBreak") and len(blocks) > 1:
            for b in blocks[1:]:
                if b["type"] == "paragraph":
                    b["attrs"]["pageBreak"] = False
        out = blocks + trailing
        M.mark_covered(out)
        return [_fix_surrogates(b) for b in out]

    # ---------- controls ----------

    def _control(self, ctrl: Record, inl: M.InlineBuilder, blocks: list[dict], trailing: list[dict],
                 attrs: dict, marks: list[dict], flush_paragraph) -> None:
        (cid,) = struct.unpack_from("<I", ctrl.data, 0) if len(ctrl.data) >= 4 else (0,)
        if cid == CTRL_SECD:
            self._section_def(ctrl)
        elif cid == CTRL_TABLE:
            table = self._table(ctrl)
            if table:
                flush_paragraph()
                if attrs.get("align") in ("center", "right") and not table["attrs"]["float"]:
                    table["attrs"]["align"] = attrs["align"]
                blocks.append(table)
                if attrs.get("pageBreak"):
                    attrs["pageBreak"] = False
        elif cid == CTRL_GSO:
            self._shape(ctrl, inl, trailing)
        elif cid == CTRL_EQ:
            eq = self._equation(ctrl)
            if eq:
                inl.node(eq)
        elif cid in (CTRL_HEADER, CTRL_FOOTER):
            paras = self._paragraphs(ctrl.children)
            kind = "header" if cid == CTRL_HEADER else "footer"
            if getattr(self, kind) is None:
                setattr(self, kind, paras)
                attrs["hf"] = (attrs.get("hf") or []) + [kind]
        elif cid in (CTRL_FOOTNOTE, CTRL_ENDNOTE):
            inl.node({
                "type": "footnote",
                "attrs": {"kind": "foot" if cid == CTRL_FOOTNOTE else "end",
                          "content": self._paragraphs(ctrl.children)},
            })
        elif cid == CTRL_PAGE_NUM_POS and self.page_number is None:
            rd = Reader(ctrl.data, 4)
            a = rd.u32()
            rd.u16()  # user char
            rd.u16()  # prefix
            rd.u16()  # suffix
            side = rd.u16()
            pos = (a >> 8) & 0xF
            if 0 < pos < len(PAGE_NUM_POS):
                self.page_number = {"pos": PAGE_NUM_POS[pos], "side": chr(side) if 32 < side < 0xFFFF else ""}

    def _section_def(self, ctrl: Record) -> None:
        if self._page_set:
            return
        if len(ctrl.data) >= 8:
            (sattr,) = struct.unpack_from("<I", ctrl.data, 4)  # 구역 정의 속성 (표 129)
            self.hide_first = {"header": bool(sattr & 1), "footer": bool(sattr & 2), "pageNum": bool(sattr & 0x20)}
        pd = ctrl.first(TAG_PAGE_DEF)
        if not pd:
            return
        rd = Reader(pd.data)
        w, h, left, right, top, bottom, header, footer, gutter = (rd.u32() for _ in range(9))
        attr = rd.u32()
        landscape = bool(attr & 1)
        if landscape and h > w or not landscape and w > h:
            w, h = h, w
        self.page = {
            "width": M.pt(w), "height": M.pt(h),
            "left": M.pt(left + gutter), "right": M.pt(right), "top": M.pt(top), "bottom": M.pt(bottom),
            "header": M.pt(header), "footer": M.pt(footer), "landscape": landscape,
        }
        self._page_set = True

    def _cell_style(self, bf_id: int) -> dict:
        bf = self.border_fills[bf_id - 1] if 0 < bf_id <= len(self.border_fills) else None
        if not bf:
            return {"borders": None, "background": None}
        return {"borders": bf["borders"], "background": bf["fill"]}

    def _table(self, ctrl: Record) -> dict | None:
        tbl = ctrl.first(TAG_TABLE)
        if tbl is None:
            return None
        rd = Reader(tbl.data)
        rd.u32()
        nrows, ncols = rd.u16(), rd.u16()
        spacing = rd.u16()
        pad = [rd.u16() for _ in range(4)]  # default cell padding l, r, t, b
        rows: list[list[dict]] = [[] for _ in range(nrows)]
        children = ctrl.children
        k = 0
        total_width = 0
        if len(ctrl.data) >= 24:
            (total_width,) = struct.unpack_from("<I", ctrl.data, 16)
        while k < len(children):
            lh = children[k]
            if lh.tag != TAG_LIST_HEADER:
                k += 1
                continue
            r = Reader(lh.data)
            npara = r.u16()
            r.u16()
            list_attr = r.u32()
            col, row, colspan, rowspan = r.u16(), r.u16(), r.u16(), r.u16()
            width, height = r.u32(), r.u32()
            margins = [r.u16() for _ in range(4)]
            bf_id = r.u16()
            paras = []
            k += 1
            while k < len(children) and len(paras) < max(1, npara) and children[k].tag == TAG_PARA_HEADER:
                paras.append(children[k])
                k += 1
            style = self._cell_style(bf_id)
            valign = (list_attr >> 5) & 0x3
            m = margins if any(margins) else pad
            cell = {
                "col": col, "row": row, "colspan": max(1, colspan), "rowspan": max(1, rowspan),
                "width": width, "height": height,
                "content": self._paragraphs(paras),
                "background": style["background"], "borders": style["borders"],
                "vAlign": ["top", "middle", "bottom"][valign] if valign < 3 else "top",
                "padding": {"left": M.pt(m[0]), "right": M.pt(m[1]), "top": M.pt(m[2]), "bottom": M.pt(m[3])},
            }
            if 0 <= row < nrows:
                rows[row].append(cell)
        if not any(rows):
            return None
        table = M.build_table(rows, ncols, total_width, spacing)
        table["attrs"]["float"] = _float(ctrl)
        return table

    def _shape(self, ctrl: Record, inl: M.InlineBuilder, trailing: list[dict]) -> None:
        width = height = 0
        if len(ctrl.data) >= 24:
            width, height = struct.unpack_from("<II", ctrl.data, 16)
        comps = list(_walk(ctrl.children, TAG_SHAPE_COMPONENT))
        pics = [c for c in comps if c.first(TAG_SHAPE_COMPONENT_PICTURE) is not None]
        for comp in comps:
            pic = comp.first(TAG_SHAPE_COMPONENT_PICTURE)
            if pic is not None and len(pic.data) >= 73:
                (bin_id,) = struct.unpack_from("<H", pic.data, 71)
                name = self._binary(bin_id)
                if name:
                    w, h = width, height
                    if len(pics) > 1:  # grouped pictures: use each one's own size
                        w, h = _component_size(comp) or (width / len(pics), height)
                    inl.node({"type": "image", "attrs": {
                        "src": name, "width": M.pt(w), "height": M.pt(h), "alt": "",
                        "float": _float(ctrl) if len(pics) == 1 else None}})
            elif comp.first(TAG_LIST_HEADER) is not None:
                # Text box (글상자): keep its text as ordinary paragraphs after the anchor paragraph.
                for p in comp.children:
                    if p.tag == TAG_PARA_HEADER:
                        trailing.extend(self._paragraph(p))

    def _binary(self, bin_id: int) -> str | None:
        item = next((b for b in self.bin_items if b.get("id") == bin_id), None)
        if item is None and 0 < bin_id <= len(self.bin_items):
            item = self.bin_items[bin_id - 1]
        if not item or item.get("kind") == "link":
            return None
        name = f"BIN{item['id']:04X}.{item['ext']}"
        if name not in self.binaries:
            path = f"BinData/{name}"
            if not self.ole.exists(path):
                return None
            data = self._raw(path)
            compress = item.get("compress", 0)
            if compress == 1 or (compress == 0 and self.compressed):
                try:
                    data = zlib.decompress(data, -15)
                except zlib.error:
                    pass
            self.binaries[name] = data
        return name

    def _equation(self, ctrl: Record) -> dict | None:
        eq = ctrl.first(TAG_EQEDIT)
        if eq is None:
            return None
        rd = Reader(eq.data)
        rd.u32()
        script = rd.wstr()
        size = rd.u32()
        color = colorref(rd.u32())
        width = height = 0
        if len(ctrl.data) >= 24:
            width, height = struct.unpack_from("<II", ctrl.data, 16)
        return {"type": "equation", "attrs": {
            "script": script, "width": M.pt(width), "height": M.pt(height),
            "size": M.rnd(size / 100) if size else 10, "color": color or "#000000"}}


def _float(ctrl: Record) -> dict | None:
    """Common object attributes at the start of a table/shape CTRL_HEADER (after the ctrl id)."""
    if len(ctrl.data) < 28:
        return None
    attr, voff, hoff, w, h, z = struct.unpack_from("<IiiIIi", ctrl.data, 4)
    return M.float_from_hwp5(attr, voff, hoff, w, h, z)


def _component_size(comp: Record) -> tuple[int, int] | None:
    """SHAPE_COMPONENT: ctrl id(s), x/y offset, group level, local version, initial w/h, current w/h."""
    data = comp.data
    off = 8 if len(data) >= 8 and data[0:4] == data[4:8] else 4  # top-level objects repeat the id
    if len(data) < off + 30:
        return None
    cur_w, cur_h = struct.unpack_from("<II", data, off + 20)
    return (cur_w, cur_h) if cur_w and cur_h else None


def _walk(recs: list[Record], tag: int):
    for r in recs:
        if r.tag == tag:
            yield r
        yield from _walk(r.children, tag)


def _fix_surrogates(node: dict) -> dict:
    """PARA_TEXT is UTF-16: re-join surrogate pairs that were split into separate chr() values."""
    if node.get("type") == "text":
        t = node["text"]
        if any(0xD800 <= ord(c) <= 0xDFFF for c in t):
            node["text"] = t.encode("utf-16-le", "surrogatepass").decode("utf-16-le", "replace")
    for c in node.get("content") or []:
        _fix_surrogates(c)
    return node


def read_hwp(data: bytes) -> tuple[dict, dict[str, bytes]]:
    doc = Hwp5Document(data)
    return doc.convert(), doc.binaries


__all__ = ["read_hwp", "HwpError", "ctrl_name"]
